import { and, asc, count, desc, eq, gt, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { application, contact, idempotencyKey, PRIORITIES, schemaVersion, status, team, ticket, ticketType, user, type ApplicationPermission, type Priority } from '../db/schema'
import type { Db, Role } from './auth'
import { validateFields, type FieldError, type FieldType, type FieldValues } from './fields'
import { allowedActions, assertAllowed, assertMayCreate, canBeAssignee, NOT_FOUND, PolicyRefusal, readableTickets, type PolicyTicket, type TicketAction } from './policy'
import type { StatusView } from './statuses'
import { loadTicketType } from './ticket-types'

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
  assignee: PersonView | null
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
}

export interface TicketDetail extends TicketSummary {
  description: string
  schema_version: number
  fields: FieldValues
  schema_fields: SchemaFieldView[]
  team: { id: number, name: string }
  /** What the Principal who asked may do now, from the policy function. */
  allowed_actions: TicketAction[]
}

/** The title and description, the part of a new ticket that does not depend on its type. */
export const ticketTextInput = z.object({
  title: z.string({ error: 'Must be text.' }).trim().min(1, 'Title is required.').max(200, 'Title must be 200 characters or fewer.'),
  description: z.string({ error: 'Must be text.' }).trim().max(20_000, 'Description must be 20000 characters or fewer.').default(''),
})

export const coreInput = ticketTextInput.extend({
  priority: z.enum(PRIORITIES, { error: 'Must be one of the options.' }).default('normal'),
})

export const typeInput = z.object({
  ticket_type_id: z.number({ error: 'Choose a Ticket Type.' }).int('Choose a Ticket Type.').positive('Choose a Ticket Type.'),
  fields: z.record(z.string(), z.unknown(), { error: 'Must be an object keyed by Field Key.' }).default({}),
})

/** The Contact a ticket from an Application is for. The same `external_id` always finds the same Contact (3.8). */
export const contactInput = z.object({
  external_id: z.string({ error: 'Must be text.' }).trim().min(1, 'The external ID is required.').max(200, 'Must be 200 characters or fewer.')
    .describe('Your ID for this person. The same ID always gives the same Contact.'),
  name: z.string({ error: 'Must be text.' }).trim().min(1, 'The name is required.').max(200, 'Must be 200 characters or fewer.'),
  email: z.email({ error: 'Must be an email address.' }).max(320, 'Must be 320 characters or fewer.'),
}, { error: 'Send the Contact: external_id, name, and email.' })

const contactPart = z.object({ contact: contactInput })

/** The body of a create from an Application. Validation checks the same parts one by one, to report every problem at once. */
export const applicationTicketInput = coreInput.extend(typeInput.shape).extend(contactPart.shape)

const UPDATABLE = { status: 'change_status', priority: 'change_priority', assignee_id: 'assign' } as const satisfies Record<string, TicketAction>

const updateInput = z.strictObject({
  status: z.string({ error: 'Must be a Status key.' }).min(1, 'Must be a Status key.').optional(),
  priority: z.enum(PRIORITIES, { error: 'Must be one of the options.' }).optional(),
  assignee_id: z.string({ error: 'Must be a User ID, or null to unassign.' }).min(1, 'Must be a User ID, or null to unassign.').nullable().optional(),
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
type DetailRow = Awaited<ReturnType<typeof selectDetail>>[number]

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
    channel: row.channel,
    application: row.applicationId === null ? null : { id: row.applicationId, name: row.applicationName! },
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

function policyFacts(row: Pick<SummaryRow, 'requesterId' | 'applicationId' | 'visibleToAll'>): PolicyTicket {
  return { requesterId: row.requesterId, applicationId: row.applicationId, visibleToAll: row.visibleToAll }
}

async function toDetail(db: Db, principal: Principal, row: DetailRow): Promise<TicketDetail> {
  if (row.teamId === null || row.teamName === null) throw new Error(`Ticket Type ${row.prefix} has no Team. Every type must have one (4.13).`)
  const [version] = await db.select({ fields: schemaVersion.fields }).from(schemaVersion)
    .where(and(eq(schemaVersion.ticketTypeId, row.typeId), eq(schemaVersion.version, row.schemaVersion))).limit(1)
  if (!version) throw new Error(`Ticket ${row.number} is pinned to Schema Version ${row.schemaVersion} of ${row.prefix}, which does not exist.`)
  return {
    ...toSummary(row),
    description: row.description,
    schema_version: row.schemaVersion,
    fields: row.fields,
    // An archived Field still shows when this ticket has a value for it.
    schema_fields: version.fields.filter(f => !f.archived || f.key in row.fields).map(f => ({ key: f.key, label: f.label, type: f.type })),
    team: { id: row.teamId, name: row.teamName },
    allowed_actions: allowedActions(principal, policyFacts(row)),
  }
}

/** The row of a ticket the Principal may do `action` on. Throws PolicyRefusal otherwise. */
async function loadFor(db: Db, principal: Principal, action: TicketAction, number: number): Promise<DetailRow> {
  const [row] = await selectDetail(db, number)
  if (!row) throw new PolicyRefusal(NOT_FOUND)
  assertAllowed(principal, action, policyFacts(row))
  return row
}

type NewTicketValues = Omit<typeof ticket.$inferInsert, 'requesterId' | 'contactId' | 'channel'>

/**
 * Checks a new ticket of the chosen type, pinned to the type's newest Schema Version, with Status `open`.
 * Throws TicketValidationError with every problem at once (core attributes, Field values, and `extraErrors`),
 * or PolicyRefusal for a type the Principal may not use.
 */
async function checkNewTicket(db: Db, principal: Principal, input: unknown, extraErrors: FieldError[] = []): Promise<NewTicketValues> {
  const core = coreInput.safeParse(input)
  const target = typeInput.safeParse(input)
  const errors = [...(core.success ? [] : coreErrors(core.error.issues)), ...(target.success ? [] : coreErrors(target.error.issues)), ...extraErrors]
  // Before the type is loaded, so an Application gets the same refusal for a type it may not use and one that does not exist.
  if (target.success) assertMayCreate(principal, target.data.ticket_type_id)

  const found = target.success ? await loadTicketType(db, target.data.ticket_type_id) : null
  let values: FieldValues = {}
  if (target.success && !found) {
    errors.push({ key: 'ticket_type_id', label: 'Ticket Type', reason: 'No Ticket Type has this ID.' })
  } else if (target.success && found) {
    const result = validateFields(found.version.fields, target.data.fields)
    if (result.ok) values = result.values
    else errors.push(...result.errors)
  }
  if (errors.length || !core.success || !found) throw new TicketValidationError(errors)

  const now = new Date()
  return {
    ticketTypeId: found.type.id,
    schemaVersion: found.version.version,
    title: core.data.title,
    description: core.data.description,
    priority: core.data.priority,
    fields: values,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }
}

/** Creates a ticket with the User as Requester. Throws TicketValidationError or PolicyRefusal. */
export async function createTicket(db: Db, principal: UserPrincipal, input: unknown): Promise<TicketDetail> {
  const values = await checkNewTicket(db, principal, input)
  const [created] = await db.insert(ticket).values({ ...values, requesterId: principal.userId, channel: principal.channel })
    .returning({ number: ticket.number })
  return getTicket(db, principal, created!.number)
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
  const values = await checkNewTicket(db, principal, input, parsedContact.success ? [] : coreErrors(parsedContact.error.issues))
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

  try {
    if (!idempotency) {
      const [, created] = await db.batch([upsertContact, insertTicket])
      return { ticket: await createdTicket(db, principal, created[0]!.number), replayed: false }
    }
    const [, , created] = await db.batch([
      // An expired key may be used again. This also keeps the table small.
      db.delete(idempotencyKey).where(and(eq(idempotencyKey.applicationId, appId), lte(idempotencyKey.createdAt, new Date(now - IDEMPOTENCY_WINDOW_MS)))),
      upsertContact,
      insertTicket,
      // The primary key refuses a second row for the key, so a concurrent repeat rolls back its whole batch.
      db.insert(idempotencyKey).values({ applicationId: appId, key: idempotency.key, requestHash: idempotency.requestHash, ticketNumber: sql`last_insert_rowid()`, createdAt: new Date(now) }),
    ])
    return { ticket: await createdTicket(db, principal, created[0]!.number), replayed: false }
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
  /** `me`: assigned to the Principal. `none`: unassigned. */
  assignee?: 'me' | 'none'
}

export interface TicketList {
  /** Ordered by Status, then by last update. At most LIST_LIMIT. */
  tickets: TicketSummary[]
  /** The number of matching tickets for each Status key, also when `tickets` is cut at the limit. */
  counts: Record<string, number>
}

export const LIST_LIMIT = 200

/** Tickets the Principal can see that match the filter. */
export async function listTickets(db: Db, principal: Principal, filter: ListFilter = {}): Promise<TicketList> {
  const me = principal.kind === 'user' ? principal.userId : null
  if (me === null && (filter.requesterIsMe || filter.assignee)) throw new Error('The "me" filters are only for Users.')
  const where = and(
    readableTickets(principal),
    filter.requesterIsMe ? eq(ticket.requesterId, me!) : undefined,
    filter.assignee === 'me' ? eq(ticket.assigneeId, me!) : undefined,
    filter.assignee === 'none' ? isNull(ticket.assigneeId) : undefined,
  )
  // Not db.batch(): it reads rows as objects, so the joined columns with the same name (`name`, `email`) overwrite each other.
  const [rows, counts] = await Promise.all([
    // Workflow order first, so open work is never the part that the limit cuts.
    selectSummaries(db, where).orderBy(asc(status.position), desc(ticket.updatedAt), desc(ticket.number)).limit(LIST_LIMIT),
    db.select({ status: ticket.status, count: count() }).from(ticket)
      .innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
      .leftJoin(contact, eq(ticket.contactId, contact.id))
      .where(where)
      .groupBy(ticket.status),
  ])
  return {
    tickets: rows.map(toSummary),
    counts: Object.fromEntries(counts.map(c => [c.status ?? '', c.count])),
  }
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
  if (errors.length) throw new TicketValidationError(errors)

  const set: Partial<typeof ticket.$inferInsert> = {}
  if (changes.status !== undefined && changes.status !== row.statusKey) set.status = changes.status
  if (changes.priority !== undefined && changes.priority !== row.priority) set.priority = changes.priority
  if (changes.assignee_id !== undefined && changes.assignee_id !== row.assigneeId) set.assigneeId = changes.assignee_id
  if (Object.keys(set).length === 0) return toDetail(db, principal, row)

  await db.update(ticket).set({ ...set, updatedAt: new Date() }).where(eq(ticket.number, number))
  return getTicket(db, principal, number)
}
