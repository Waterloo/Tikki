import { and, asc, count, desc, eq, gt, isNull, lt, lte, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { BatchItem } from 'drizzle-orm/batch'
import { z } from 'zod'
import { application, comment, contact, idempotencyKey, PRIORITIES, schemaVersion, status, team, ticket, ticketType, user, type ApplicationPermission, type AuditAction, type Priority } from '../db/schema'
import { auditEntry } from './audit'
import type { Db, Role } from './auth'
import { checkFileRefs, claimUploads } from './attachments'
import { activeOptions, validateFields, type FieldDef, type FieldError, type FieldType, type FieldValues } from './fields'
import { noticeTicketCreated, noticesForChange } from './notifications'
import { queueNoticeMail } from './notice-mail'
import { allowedActions, assertAllowed, assertMayCreate, canBeAssignee, canReadInternalComments, NOT_FOUND, PolicyRefusal, readableTickets, type PolicyTicket, type TicketAction } from './policy'
import type { StatusView } from './statuses'
import { loadTicketType } from './ticket-types'
import { changedKey, withEvent } from './outbox'

export type Channel = 'web' | 'ai' | 'api'

/** A User. `channel: 'ai'` is a User acting through Claude, with the same rights as the User (5.1). */
export interface UserPrincipal {
  kind: 'user'
  userId: string
  role: Role
  channel: 'web' | 'ai'
}

/** An Application with an API key. Its rights are its permissions and allowed Ticket Types, never a Role. */
export interface ApplicationPrincipal {
  kind: 'application'
  applicationId: number
  permissions: readonly ApplicationPermission[]
  ticketTypeIds: readonly number[]
  channel: 'api'
}

/** Who acts (glossary: Principal). */
export type Principal = UserPrincipal | ApplicationPrincipal

export interface PersonView {
  id: string
  name: string
  email: string
}

/**
 * Who did something. An Application acts for the Contact of its own ticket, so it shows as that Contact through the
 * Application. An Application viewer sees staff as `support`, without name or email (customer systems get no staff emails).
 */
export type ActorView =
  | (PersonView & { kind: 'user' })
  | { kind: 'contact', contact: { id: number, external_id: string, name: string, email: string }, application: { id: number, name: string } }
  | { kind: 'support' }

/** The columns of a row that a User or an Application wrote (`author_id`/`uploader_id`/`principal_id` or `application_id`). */
export function actorId(principal: Principal): string | null {
  return principal.kind === 'user' ? principal.userId : null
}

/** A User, or a Contact of an Application. */
export type RequesterView =
  | (PersonView & { kind: 'user' })
  | { kind: 'contact', id: number, external_id: string, name: string, email: string }

/** A ticket in a list. */
export interface TicketSummary {
  number: number
  ref: string
  title: string
  priority: Priority
  status: StatusView
  ticket_type: { id: number, name: string, prefix: string, icon: string, color: string }
  requester: RequesterView
  /** Null for an Application: it learns only `assigned`, not the staff member. */
  assignee: PersonView | null
  assigned: boolean
  channel: Channel
  /** The Application that created the ticket, for tickets from the API. */
  application: { id: number, name: string } | null
  created_at: string
  updated_at: string
}

/** A Field of the ticket's pinned Schema Version, so a reader can label the values. */
export interface SchemaFieldView {
  key: string
  label: string
  type: FieldType
  required: boolean
  help: string
  /** Active options of a select Field. */
  options?: string[]
}

export interface TicketDetail extends TicketSummary {
  description: string
  schema_version: number
  fields: FieldValues
  schema_fields: SchemaFieldView[]
  team: { id: number, name: string }
  /** The comments the Principal can see. Internal Comments count only for Users who can see them. */
  comment_count: number
  /** The old ticket, when a Requester reopened it after the 14 days (4.22). */
  reopened_from: { number: number, ref: string } | null
  /** What the Principal who asked may do now, from the policy function. */
  allowed_actions: TicketAction[]
}

/** The title and description, the part of a new ticket that does not depend on its type. */
// In their own module, so the build-time OpenAPI step can load them without the Worker runtime.
import { applicationTicketInput, contactInput, contactPart, coreInput, ticketTextInput, typeInput } from './ticket-input'
export { applicationTicketInput, contactInput, coreInput, ticketTextInput, typeInput }

const UPDATABLE = { status: 'change_status', priority: 'change_priority', assignee_id: 'assign', fields: 'edit_fields', description: 'edit_description' } as const satisfies Record<string, TicketAction>

const updateInput = z.strictObject({
  status: z.string({ error: 'Must be a Status key.' }).min(1, 'Must be a Status key.').optional(),
  priority: z.enum(PRIORITIES, { error: 'Must be one of the options.' }).optional(),
  assignee_id: z.string({ error: 'Must be a User ID, or null to unassign.' }).min(1, 'Must be a User ID, or null to unassign.').nullable().optional(),
  // Not `ticketTextInput.shape.description`: its default would clear the description when none is sent.
  description: z.string({ error: 'Must be text.' }).trim().max(20_000, 'Description must be 20000 characters or fewer.').optional(),
  // Only the Fields that are sent change. An empty value clears the Field.
  fields: z.record(z.string(), z.unknown(), { error: 'Must be an object keyed by Field Key.' }).optional(),
}, {
  error: issue => issue.code === 'unrecognized_keys'
    ? `Only ${Object.keys(UPDATABLE).join(', ')} can change here. Unknown: ${issue.keys.join(', ')}.`
    : 'Must be an object.',
})

const coreLabels: Record<string, string> = {
  contact: 'Contact',
  title: 'Title',
  description: 'Description',
  priority: 'Priority',
  ticket_type_id: 'Ticket Type',
  fields: 'Fields',
  status: 'Status',
  assignee_id: 'Assignee',
}

/** Errors for the core attributes use the attribute name as `key`, so Field Keys must not reuse these names. */
function coreErrors(issues: z.core.$ZodIssue[]): FieldError[] {
  return issues.map((issue) => {
    // Nested keys only exist inside `contact`, for example `contact.email`.
    const key = issue.path.length ? issue.path.map(String).join('.') : 'body'
    const error: FieldError = { key, label: coreLabels[String(issue.path[0])] ?? 'Request body', reason: issue.message }
    if (key === 'priority') error.options = [...PRIORITIES]
    return error
  })
}

export class TicketValidationError extends Error {
  constructor(readonly details: FieldError[]) {
    super(details.map(d => `${d.key} (${d.label}): ${d.reason}${d.options ? ` Options: ${d.options.join(', ')}.` : ''}`).join(' '))
    this.name = 'TicketValidationError'
  }
}

/** A Ticket Reference (`BUG-12`) or a bare number. Lookup uses only the number, so every earlier prefix still works (4.9a). */
export function parseTicketReference(value: string): number | null {
  const match = /^(?:[A-Za-z]{2,5}-)?([1-9]\d{0,15})$/.exec(value.trim())
  return match ? Number(match[1]) : null
}

const requester = alias(user, 'requester')
const source = alias(application, 'source')
const assignee = alias(user, 'assignee')

const summaryColumns = {
  number: ticket.number,
  title: ticket.title,
  priority: ticket.priority,
  channel: ticket.channel,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  requesterId: ticket.requesterId,
  contactId: contact.id,
  contactExternalId: contact.externalId,
  contactName: contact.name,
  contactEmail: contact.email,
  applicationId: source.id,
  applicationName: source.name,
  statusKey: status.key,
  statusPosition: status.position,
  statusName: status.name,
  statusCategory: status.category,
  typeId: ticketType.id,
  typeName: ticketType.name,
  prefix: ticketType.prefix,
  typeIcon: ticketType.icon,
  typeColor: ticketType.color,
  visibleToAll: ticketType.visibleToAll,
  requesterName: requester.name,
  requesterEmail: requester.email,
  assigneeId: assignee.id,
  assigneeName: assignee.name,
  assigneeEmail: assignee.email,
}

const detailColumns = {
  ...summaryColumns,
  description: ticket.description,
  schemaVersion: ticket.schemaVersion,
  fields: ticket.fields,
  reopenedFrom: ticket.reopenedFrom,
  teamId: team.id,
  teamName: team.name,
}

function selectSummaries(db: Db, where: SQL | undefined) {
  return db.select(summaryColumns).from(ticket)
    .innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
    // Left joins, so a row with a missing Status or Team fails loudly in toSummary instead of vanishing from lists.
    .leftJoin(status, eq(ticket.status, status.key))
    .leftJoin(requester, eq(ticket.requesterId, requester.id))
    .leftJoin(contact, eq(ticket.contactId, contact.id))
    .leftJoin(source, eq(contact.applicationId, source.id))
    .leftJoin(assignee, eq(ticket.assigneeId, assignee.id))
    .where(where)
}

function selectDetail(db: Db, number: number) {
  return db.select(detailColumns).from(ticket)
    .innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
    .leftJoin(status, eq(ticket.status, status.key))
    .leftJoin(requester, eq(ticket.requesterId, requester.id))
    .leftJoin(contact, eq(ticket.contactId, contact.id))
    .leftJoin(source, eq(contact.applicationId, source.id))
    .leftJoin(assignee, eq(ticket.assigneeId, assignee.id))
    .leftJoin(team, eq(ticketType.teamId, team.id))
    .where(eq(ticket.number, number))
    .limit(1)
}

type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number]
export type DetailRow = Awaited<ReturnType<typeof selectDetail>>[number]

function toRequester(row: SummaryRow): RequesterView {
  if (row.contactId !== null) {
    return { kind: 'contact', id: row.contactId, external_id: row.contactExternalId!, name: row.contactName!, email: row.contactEmail! }
  }
  if (row.requesterId === null || row.requesterName === null || row.requesterEmail === null) {
    throw new Error(`Ticket ${row.number} has no Requester. Every ticket must have one.`)
  }
  return { kind: 'user', id: row.requesterId, name: row.requesterName, email: row.requesterEmail }
}

function toSummary(row: SummaryRow): TicketSummary {
  if (row.statusKey === null || row.statusName === null || row.statusCategory === null) {
    throw new Error(`Ticket ${row.number} has no Status. Every ticket must have one (4.10).`)
  }
  return {
    number: row.number,
    ref: `${row.prefix}-${row.number}`,
    title: row.title,
    priority: row.priority,
    status: { key: row.statusKey, name: row.statusName, category: row.statusCategory },
    ticket_type: { id: row.typeId, name: row.typeName, prefix: row.prefix, icon: row.typeIcon, color: row.typeColor },
    requester: toRequester(row),
    assignee: row.assigneeId === null ? null : { id: row.assigneeId, name: row.assigneeName ?? '', email: row.assigneeEmail ?? '' },
    assigned: row.assigneeId !== null,
    channel: row.channel,
    application: row.applicationId === null ? null : { id: row.applicationId, name: row.applicationName! },
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

/** An Application learns whether a ticket has an assignee, never who it is. */
function forViewer(principal: Principal, summary: TicketSummary): TicketSummary {
  return principal.kind === 'application' ? { ...summary, assignee: null } : summary
}

export function policyFacts(row: Pick<SummaryRow, 'requesterId' | 'applicationId' | 'visibleToAll' | 'statusKey' | 'statusCategory'>): PolicyTicket {
  if (row.statusKey === null || row.statusCategory === null) throw new Error('A ticket has no Status. Every ticket must have one (4.10).')
  return { requesterId: row.requesterId, applicationId: row.applicationId, visibleToAll: row.visibleToAll, statusKey: row.statusKey, statusCategory: row.statusCategory }
}

/** The Fields of the Schema Version that the ticket is pinned to. */
export async function pinnedFields(db: Db, row: Pick<DetailRow, 'number' | 'typeId' | 'prefix' | 'schemaVersion'>): Promise<FieldDef[]> {
  const [version] = await db.select({ fields: schemaVersion.fields }).from(schemaVersion)
    .where(and(eq(schemaVersion.ticketTypeId, row.typeId), eq(schemaVersion.version, row.schemaVersion))).limit(1)
  if (!version) throw new Error(`Ticket ${row.number} is pinned to Schema Version ${row.schemaVersion} of ${row.prefix}, which does not exist.`)
  return version.fields
}

async function toDetail(db: Db, principal: Principal, row: DetailRow): Promise<TicketDetail> {
  if (row.teamId === null || row.teamName === null) throw new Error(`Ticket Type ${row.prefix} has no Team. Every type must have one (4.13).`)
  const [fields, [comments], [origin]] = await Promise.all([
    pinnedFields(db, row),
    db.select({ n: count() }).from(comment)
      .where(and(eq(comment.ticketNumber, row.number), canReadInternalComments(principal) ? undefined : eq(comment.visibility, 'public'))),
    row.reopenedFrom === null
      ? Promise.resolve([])
      : db.select({ prefix: ticketType.prefix }).from(ticket).innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id)).where(eq(ticket.number, row.reopenedFrom)),
  ])
  return {
    ...forViewer(principal, toSummary(row)),
    description: row.description,
    schema_version: row.schemaVersion,
    fields: row.fields,
    // An archived Field still shows when this ticket has a value for it.
    schema_fields: fields.filter(f => !f.archived || f.key in row.fields).map(f => ({
      key: f.key, label: f.label, type: f.type, required: f.required, help: f.help,
      ...(f.options ? { options: activeOptions(f) } : {}),
    })),
    team: { id: row.teamId, name: row.teamName },
    comment_count: comments!.n,
    reopened_from: row.reopenedFrom === null ? null : { number: row.reopenedFrom, ref: `${origin?.prefix ?? '?'}-${row.reopenedFrom}` },
    allowed_actions: allowedActions(principal, policyFacts(row)),
  }
}

/** The row of a ticket the Principal may do `action` on. Throws PolicyRefusal otherwise. */
export async function loadFor(db: Db, principal: Principal, action: TicketAction, number: number): Promise<DetailRow> {
  const [row] = await selectDetail(db, number)
  if (!row) throw new PolicyRefusal(NOT_FOUND)
  assertAllowed(principal, action, policyFacts(row))
  return row
}

interface NewTicket {
  values: Omit<typeof ticket.$inferInsert, 'requesterId' | 'contactId' | 'channel'>
  /** Uploads that file Fields point to. The create claims them for the new ticket. */
  fileIds: string[]
}

/**
 * Checks a new ticket of the chosen type, pinned to the type's newest Schema Version, with Status `open`.
 * Throws TicketValidationError with every problem at once (core attributes, Field values, and `extraErrors`),
 * or PolicyRefusal for a type the Principal may not use.
 */
async function checkNewTicket(db: Db, principal: Principal, input: unknown, extraErrors: FieldError[] = []): Promise<NewTicket> {
  const core = coreInput.safeParse(input)
  const target = typeInput.safeParse(input)
  const errors = [...(core.success ? [] : coreErrors(core.error.issues)), ...(target.success ? [] : coreErrors(target.error.issues)), ...extraErrors]
  // Before the type is loaded, so an Application gets the same refusal for a type it may not use and one that does not exist.
  if (target.success) assertMayCreate(principal, target.data.ticket_type_id)

  const found = target.success ? await loadTicketType(db, target.data.ticket_type_id) : null
  let values: FieldValues = {}
  let fileIds: string[] = []
  if (target.success && !found) {
    errors.push({ key: 'ticket_type_id', label: 'Ticket Type', reason: 'No Ticket Type has this ID.' })
  } else if (target.success && found?.archived) {
    errors.push({ key: 'ticket_type_id', label: 'Ticket Type', reason: 'This Ticket Type is archived and takes no new tickets. Choose another one.' })
  } else if (target.success && found) {
    const result = validateFields(found.version.fields, target.data.fields)
    if (result.ok) {
      values = result.values
      const refs = found.version.fields.filter(f => f.type === 'file' && f.key in values).map(f => ({ key: f.key, label: f.label, id: values[f.key] }))
      errors.push(...await checkFileRefs(db, principal, null, refs))
      fileIds = refs.map(r => String(r.id))
    } else {
      errors.push(...result.errors)
    }
  }
  if (errors.length || !core.success || !found) throw new TicketValidationError(errors)

  const now = new Date()
  return {
    values: {
      ticketTypeId: found.type.id,
      schemaVersion: found.version.version,
      title: core.data.title,
      description: core.data.description,
      priority: core.data.priority,
      fields: values,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    },
    fileIds,
  }
}

/** Creates a ticket with the User as Requester. Throws TicketValidationError or PolicyRefusal. */
export async function createTicket(db: Db, principal: UserPrincipal, input: unknown): Promise<TicketDetail> {
  const { values, fileIds } = await checkNewTicket(db, principal, input)
  const [created] = await db.batch(withEvent(db, principal, { type: 'ticket.created', ticketNumber: sql`(SELECT max(number) FROM ticket)` }, [
    db.insert(ticket).values({ ...values, requesterId: principal.userId, channel: principal.channel }).returning({ number: ticket.number }),
    // An update keeps last_insert_rowid(), so the uploads join the new ticket; the audit insert must come last.
    ...(fileIds.length ? [claimUploads(db, principal, fileIds)] : []),
    auditEntry(db, principal, { ticketNumber: sql`last_insert_rowid()`, action: 'ticket_created' }),
    noticeTicketCreated(db, principal.userId),
  ])) as [{ number: number }[]]
  queueNoticeMail({ ticket: created[0]!.number })
  return getTicket(db, principal, created[0]!.number)
}

/** The first result of a create is kept this long for its `Idempotency-Key` (6.3). */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000

export interface Idempotency {
  key: string
  /** Hex SHA-256 of the request body. */
  requestHash: string
}

/** The same `Idempotency-Key` came with another body. Nothing was created. */
export class IdempotencyMismatch extends Error {
  constructor() {
    super('This Idempotency-Key was used with another request body in the last 24 hours. Use a new key for a new ticket.')
    this.name = 'IdempotencyMismatch'
  }
}

/** The ticket of an earlier create with this key in the window, or null. Throws IdempotencyMismatch for another body. */
async function findReplay(db: Db, principal: ApplicationPrincipal, idempotency: Idempotency, now: number): Promise<number | null> {
  const [row] = await db.select({ requestHash: idempotencyKey.requestHash, ticketNumber: idempotencyKey.ticketNumber }).from(idempotencyKey)
    .where(and(
      eq(idempotencyKey.applicationId, principal.applicationId),
      eq(idempotencyKey.key, idempotency.key),
      gt(idempotencyKey.createdAt, new Date(now - IDEMPOTENCY_WINDOW_MS)),
    )).limit(1)
  if (!row) return null
  if (row.requestHash !== idempotency.requestHash) throw new IdempotencyMismatch()
  return row.ticketNumber
}

/** The result of a create, for the Application that made it, also when it has no `tickets:read`. */
async function createdTicket(db: Db, principal: ApplicationPrincipal, number: number): Promise<TicketDetail> {
  const [row] = await selectDetail(db, number)
  if (!row || row.applicationId !== principal.applicationId) throw new Error(`Ticket ${number} is not a ticket of Application ${principal.applicationId}.`)
  return toDetail(db, principal, row)
}

function isIdempotencyConflict(error: unknown): boolean {
  // Drizzle wraps the D1 error, so the SQLite message can be on the cause.
  const messages = [error, (error as { cause?: unknown })?.cause].map(e => (e instanceof Error ? e.message : ''))
  return messages.some(m => m.includes('UNIQUE constraint failed: idempotency_key'))
}

/**
 * Creates a ticket for a Contact of the Application. The Contact is found or made from `contact.external_id` (3.8),
 * and its name and email are updated to the values sent. With an Idempotency-Key, a repeat in 24 hours returns the
 * first ticket and creates nothing (6.3). Throws TicketValidationError, PolicyRefusal, or IdempotencyMismatch.
 */
export async function createApplicationTicket(db: Db, principal: ApplicationPrincipal, input: unknown, idempotency?: Idempotency): Promise<{ ticket: TicketDetail, replayed: boolean }> {
  assertMayCreate(principal)
  const now = Date.now()
  if (idempotency) {
    const replay = await findReplay(db, principal, idempotency, now)
    if (replay !== null) return { ticket: await createdTicket(db, principal, replay), replayed: true }
  }

  const parsedContact = contactPart.safeParse(input)
  // No file IDs to claim: an Application cannot upload before the ticket exists, so checkNewTicket refuses file Fields.
  const { values } = await checkNewTicket(db, principal, input, parsedContact.success ? [] : coreErrors(parsedContact.error.issues))
  const person = parsedContact.data!.contact
  const appId = principal.applicationId

  // One batch, so D1 runs it as one transaction: the Contact, the ticket, and the key all exist, or none does.
  const upsertContact = db.insert(contact)
    .values({ applicationId: appId, externalId: person.external_id, name: person.name, email: person.email, createdAt: values.createdAt, updatedAt: values.createdAt })
    .onConflictDoUpdate({ target: [contact.applicationId, contact.externalId], set: { name: person.name, email: person.email, updatedAt: values.createdAt } })
  const insertTicket = db.insert(ticket).values({
    ...values,
    contactId: sql`(SELECT ${contact.id} FROM ${contact} WHERE ${contact.applicationId} = ${appId} AND ${contact.externalId} = ${person.external_id})`,
    channel: 'api',
  }).returning({ number: ticket.number })

  // noticeTicketCreated reads last_insert_rowid() as the audit entry, so it comes right after it. A Contact is no User,
  // so it gets no Inbox notice; the staff of the type's Team do.
  // The new ticket has the highest number: D1 runs one batch at a time.
  const newTicketEvent = { type: 'ticket.created', ticketNumber: sql`(SELECT max(number) FROM ticket)` } as const
  const created = (ticketNumber: SQL) => [auditEntry(db, principal, { ticketNumber, action: 'ticket_created' }), noticeTicketCreated(db, null)] as const

  try {
    if (!idempotency) {
      const [, inserted] = await db.batch(withEvent(db, principal, newTicketEvent, [upsertContact, insertTicket, ...created(sql`last_insert_rowid()`)])) as [unknown, { number: number }[]]
      queueNoticeMail({ ticket: inserted[0]!.number })
      return { ticket: await createdTicket(db, principal, inserted[0]!.number), replayed: false }
    }
    const [, , inserted] = await db.batch(withEvent(db, principal, newTicketEvent, [
      // An expired key may be used again. This also keeps the table small.
      db.delete(idempotencyKey).where(and(eq(idempotencyKey.applicationId, appId), lte(idempotencyKey.createdAt, new Date(now - IDEMPOTENCY_WINDOW_MS)))),
      upsertContact,
      insertTicket,
      // The primary key refuses a second row for the key, so a concurrent repeat rolls back its whole batch.
      db.insert(idempotencyKey).values({ applicationId: appId, key: idempotency.key, requestHash: idempotency.requestHash, ticketNumber: sql`last_insert_rowid()`, createdAt: new Date(now) }),
      ...created(sql`(SELECT ${idempotencyKey.ticketNumber} FROM ${idempotencyKey} WHERE ${idempotencyKey.applicationId} = ${appId} AND ${idempotencyKey.key} = ${idempotency.key})`),
    ])) as [unknown, unknown, { number: number }[]]
    queueNoticeMail({ ticket: inserted[0]!.number })
    return { ticket: await createdTicket(db, principal, inserted[0]!.number), replayed: false }
  } catch (error) {
    if (!idempotency || !isIdempotencyConflict(error)) throw error
    const replay = await findReplay(db, principal, idempotency, now)
    if (replay === null) throw error
    return { ticket: await createdTicket(db, principal, replay), replayed: true }
  }
}

export interface ListFilter {
  /** Only the Principal's own tickets. */
  requesterIsMe?: boolean
  /** `me`: assigned to the Principal. `none`: unassigned. Any other value is a User ID. */
  assignee?: string
  /** Words in the title or description, or a Ticket Reference. Every word must match. */
  search?: string
  ticketTypeId?: number
  priority?: Priority
  /** Field Key and the wanted value. Matches tickets of every Schema Version (4.5). */
  fields?: { key: string, value: string }[]
  /** Only tickets whose Status Category is not `done`. */
  openOnly?: boolean
}

export interface ListOptions {
  /** From the `next_cursor` of the previous page. */
  cursor?: string
  limit?: number
}

export interface TicketList {
  /** Ordered by Status, then by last update. One page. */
  tickets: TicketSummary[]
  /** The number of matching tickets for each Status key, over all pages. */
  counts: Record<string, number>
  /** Pass as `cursor` for the next page. Null on the last page. */
  nextCursor: string | null
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200
const MAX_SEARCH_WORDS = 8
export const MAX_SEARCH_LENGTH = 200
export const FIELD_KEY = /^[\w-]{1,64}$/

/** `%` and `_` in the input are text, not wildcards. */
function likePattern(word: string) {
  return `%${word.replace(/[\\%_]/g, '\\$&')}%`
}

const contains = (column: SQLWrapper, word: string) => sql`${column} LIKE ${likePattern(word)} ESCAPE '\\'`

/** Every word must be in the title or the description. A word that is a Ticket Reference also matches that number (4.9a). */
function searchCondition(search: string): SQL | undefined {
  const words = search.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS)
  return and(...words.map((word) => {
    const number = parseTicketReference(word)
    return or(contains(ticket.title, word), contains(ticket.description, word), number === null ? undefined : eq(ticket.number, number))
  }))
}

/** A multi-select value is an array, so the filter also matches one of its items. */
function fieldCondition(key: string, value: string): SQL {
  const path = `$."${key}"`
  return sql`(json_extract(${ticket.fields}, ${path}) = ${value} OR (json_type(${ticket.fields}, ${path}) = 'array' AND EXISTS (SELECT 1 FROM json_each(${ticket.fields}, ${path}) WHERE value = ${value})))`
}

function filterCondition(principal: Principal, filter: ListFilter): SQL | undefined {
  const me = principal.kind === 'user' ? principal.userId : null
  if (me === null && (filter.requesterIsMe || filter.assignee)) throw new Error('The requester and assignee filters are only for Users.')
  const assignee = filter.assignee === 'me' ? me! : filter.assignee
  return and(
    readableTickets(principal),
    filter.requesterIsMe ? eq(ticket.requesterId, me!) : undefined,
    assignee === 'none' ? isNull(ticket.assigneeId) : assignee ? eq(ticket.assigneeId, assignee) : undefined,
    filter.search ? searchCondition(filter.search) : undefined,
    filter.ticketTypeId !== undefined ? eq(ticket.ticketTypeId, filter.ticketTypeId) : undefined,
    filter.priority ? eq(ticket.priority, filter.priority) : undefined,
    ...(filter.fields ?? []).map(f => fieldCondition(f.key, f.value)),
    filter.openOnly ? ne(status.category, 'done') : undefined,
  )
}

// The cursor is the sort key of the last row: Status position, update time, number. The tuple is unique, so no row
// repeats or is skipped. A ticket that changes between two page requests can move; the next list call shows it.
type CursorKey = [position: number, updatedAt: number, number: number]

function encodeCursor(row: SummaryRow): string {
  if (row.statusPosition === null) throw new Error(`Ticket ${row.number} has no Status. Every ticket must have one (4.10).`)
  return btoa(JSON.stringify([row.statusPosition, row.updatedAt.getTime(), row.number] satisfies CursorKey))
}

function decodeCursor(cursor: string): CursorKey {
  try {
    const key = JSON.parse(atob(cursor)) as unknown
    if (Array.isArray(key) && key.length === 3 && key.every(n => Number.isSafeInteger(n))) return key as CursorKey
  } catch { /* falls through */ }
  throw new TicketValidationError([{ key: 'cursor', label: 'Cursor', reason: 'Must be the next_cursor of a previous page.' }])
}

function afterCursor([position, updatedAt, number]: CursorKey): SQL {
  const updated = new Date(updatedAt)
  return or(
    gt(status.position, position),
    and(eq(status.position, position), or(lt(ticket.updatedAt, updated), and(eq(ticket.updatedAt, updated), lt(ticket.number, number)))),
  )!
}

/** One page of the tickets the Principal can see that match the filter. */
export async function listTickets(db: Db, principal: Principal, filter: ListFilter = {}, options: ListOptions = {}): Promise<TicketList> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const where = filterCondition(principal, filter)
  const pageWhere = options.cursor ? and(where, afterCursor(decodeCursor(options.cursor))) : where
  // Not db.batch(): it reads rows as objects, so the joined columns with the same name (`name`, `email`) overwrite each other.
  const [rows, counts] = await Promise.all([
    // One extra row tells whether another page exists.
    selectSummaries(db, pageWhere).orderBy(asc(status.position), desc(ticket.updatedAt), desc(ticket.number)).limit(limit + 1),
    db.select({ status: ticket.status, count: count() }).from(ticket)
      .innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
      .leftJoin(status, eq(ticket.status, status.key))
      .leftJoin(contact, eq(ticket.contactId, contact.id))
      .where(where)
      .groupBy(ticket.status),
  ])
  const page = rows.slice(0, limit)
  return {
    tickets: page.map(r => forViewer(principal, toSummary(r))),
    counts: Object.fromEntries(counts.map(c => [c.status ?? '', c.count])),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
  }
}

const SIMILAR_LIMIT = 5
const SIMILAR_MIN_WORD = 3

/**
 * Open tickets whose title shares words with `title`, best match first. Only tickets the Principal can read.
 * A title of one word needs that word; a longer one needs two, so common words alone do not match.
 */
export async function similarTickets(db: Db, principal: Principal, title: string): Promise<TicketSummary[]> {
  const words = [...new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= SIMILAR_MIN_WORD))].slice(0, MAX_SEARCH_WORDS)
  if (words.length === 0) return []
  const hits = words.map(w => sql`(${contains(ticket.title, w)})`)
  const score = sql<number>`(${sql.join(hits, sql` + `)})`
  const rows = await selectSummaries(db, and(readableTickets(principal), ne(status.category, 'done'), sql`${score} >= ${Math.min(2, words.length)}`))
    .orderBy(desc(score), desc(ticket.updatedAt), desc(ticket.number))
    .limit(SIMILAR_LIMIT)
  return rows.map(r => forViewer(principal, toSummary(r)))
}

/** The ticket, if the Principal may read it. Throws PolicyRefusal otherwise. */
export async function getTicket(db: Db, principal: Principal, number: number): Promise<TicketDetail> {
  return toDetail(db, principal, await loadFor(db, principal, 'read', number))
}

/**
 * Changes Status, Priority, or assignee. The policy decides each key that is sent; one refused key refuses the
 * whole request, and nothing changes. Throws PolicyRefusal or TicketValidationError.
 */
export async function updateTicket(db: Db, principal: Principal, number: number, input: unknown): Promise<TicketDetail> {
  const row = await loadFor(db, principal, 'read', number)
  const parsed = updateInput.safeParse(input)
  if (!parsed.success) throw new TicketValidationError(coreErrors(parsed.error.issues))
  const changes = parsed.data
  const keys = Object.keys(changes) as (keyof typeof UPDATABLE)[]
  if (keys.length === 0) {
    throw new TicketValidationError([{ key: 'body', label: 'Request body', reason: `Send at least one of ${Object.keys(UPDATABLE).join(', ')}.` }])
  }
  for (const key of keys) assertAllowed(principal, UPDATABLE[key], policyFacts(row))

  const errors: FieldError[] = []
  if (changes.status !== undefined) {
    const known = await db.select({ key: status.key }).from(status).orderBy(asc(status.position))
    if (!known.some(s => s.key === changes.status)) {
      errors.push({ key: 'status', label: 'Status', reason: 'Must be one of the options.', options: known.map(s => s.key) })
    }
  }
  if (changes.assignee_id) {
    const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, changes.assignee_id)).limit(1)
    if (!target || !canBeAssignee(target.role)) errors.push({ key: 'assignee_id', label: 'Assignee', reason: 'Must be the ID of an Agent or Admin.' })
  }
  let nextFields: FieldValues | undefined
  if (changes.fields !== undefined) {
    const defs = await pinnedFields(db, row)
    const sent = changes.fields
    const unknown = Object.keys(sent).filter(k => !defs.some(f => f.key === k))
    for (const key of unknown) {
      errors.push({ key, label: key, reason: `This ticket has no Field with this key. Known keys: ${defs.filter(f => !f.archived).map(f => f.key).join(', ') || 'none'}.` })
    }
    // Validate only the sent Fields, so an old value that is no longer valid never blocks another edit.
    const result = validateFields(defs.filter(f => f.key in sent), Object.fromEntries(Object.entries(sent).filter(([k]) => !unknown.includes(k))))
    if (result.ok) {
      nextFields = { ...row.fields }
      for (const key of Object.keys(sent)) {
        if (unknown.includes(key)) continue
        if (key in result.values) nextFields[key] = result.values[key]
        else delete nextFields[key]
      }
    } else {
      errors.push(...result.errors)
    }
  }
  if (errors.length) throw new TicketValidationError(errors)

  const set: Partial<typeof ticket.$inferInsert> = {}
  const entries: ChangeEntry[] = []
  if (changes.status !== undefined && changes.status !== row.statusKey) {
    set.status = changes.status
    entries.push({ action: 'status_changed', before: row.statusKey, after: changes.status })
  }
  if (changes.priority !== undefined && changes.priority !== row.priority) {
    set.priority = changes.priority
    entries.push({ action: 'priority_changed', before: row.priority, after: changes.priority })
  }
  if (changes.assignee_id !== undefined && changes.assignee_id !== row.assigneeId) {
    set.assigneeId = changes.assignee_id
    entries.push({ action: 'assignee_changed', before: row.assigneeId, after: changes.assignee_id })
  }
  if (changes.description !== undefined && changes.description !== row.description) {
    set.description = changes.description
    entries.push({ action: 'description_changed', before: row.description, after: changes.description })
  }
  if (nextFields) {
    for (const key of new Set([...Object.keys(row.fields), ...Object.keys(nextFields)])) {
      const [before, after] = [row.fields[key] ?? null, nextFields[key] ?? null]
      if (JSON.stringify(before) !== JSON.stringify(after)) entries.push({ action: 'field_changed', fieldKey: key, before, after })
    }
    if (entries.some(e => e.action === 'field_changed')) set.fields = nextFields
  }
  if (entries.length === 0) return toDetail(db, principal, row)

  await applyChange(db, principal, number, set, entries)
  return getTicket(db, principal, number)
}

/** One change of one value, for the audit log. `before` and `after` are the real values, `null` for none. */
export interface ChangeEntry {
  action: Extract<AuditAction, 'status_changed' | 'priority_changed' | 'assignee_changed' | 'field_changed' | 'type_changed' | 'description_changed' | 'ticket_cancelled' | 'ticket_reopened'>
  fieldKey?: string
  before: unknown
  after: unknown
  revertsId?: number
}

/** Writes the change, one audit entry for each value, and the outbox Event in one batch. Every change to a ticket goes through here. */
export async function applyChange(db: Db, principal: Principal, number: number, set: Partial<typeof ticket.$inferInsert>, entries: ChangeEntry[], extra: BatchItem<'sqlite'>[] = [], now = new Date()) {
  await db.batch(withEvent(db, principal, { type: 'ticket.updated', ticketNumber: number, changed: entries.map(changedKey) }, [
    db.update(ticket).set({ ...set, updatedAt: now }).where(eq(ticket.number, number)),
    ...entries.map(e => auditEntry(db, principal, {
      ticketNumber: number,
      action: e.action,
      fieldKey: e.fieldKey,
      revertsId: e.revertsId,
      values: { before: e.before, after: e.after },
    })),
    ...extra,
    ...noticesForChange(db, principal.kind === 'user' ? principal.userId : null, number, entries),
  ]))
  queueNoticeMail({ ticket: number })
}
