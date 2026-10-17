import { and, asc, count, desc, eq, gt, isNull, lt, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { comment, PRIORITIES, schemaVersion, status, team, ticket, ticketType, user, type AuditAction, type Priority } from '../db/schema'
import { auditEntry } from './audit'
import type { Db, Role } from './auth'
import { validateFields, type FieldDef, type FieldError, type FieldType, type FieldValues } from './fields'
import { allowedActions, assertAllowed, canBeAssignee, canSeeInternal, NOT_FOUND, PolicyRefusal, readableTickets, type PolicyTicket, type TicketAction } from './policy'
import type { StatusView } from './statuses'
import { loadTicketType } from './ticket-types'
import { changedKey, withEvent } from './outbox'

export type Channel = 'web' | 'ai' | 'api'

/** Who acts. `channel: 'ai'` is a User acting through Claude, with the same rights as the User (5.1). */
export interface Principal {
  userId: string
  role: Role
  channel: Channel
}

export interface PersonView {
  id: string
  name: string
  email: string
}

/** A ticket in a list. */
export interface TicketSummary {
  number: number
  ref: string
  title: string
  priority: Priority
  status: StatusView
  ticket_type: { id: number, name: string, prefix: string, icon: string, color: string }
  requester: PersonView
  assignee: PersonView | null
  channel: Channel
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
  /** The comments the Principal can see. Internal Comments count only for Users who can see them. */
  comment_count: number
  /** What the Principal who asked may do now, from the policy function. */
  allowed_actions: TicketAction[]
}

/** The title and description, the part of a new ticket that does not depend on its type. */
export const ticketTextInput = z.object({
  title: z.string({ error: 'Must be text.' }).trim().min(1, 'Title is required.').max(200, 'Title must be 200 characters or fewer.'),
  description: z.string({ error: 'Must be text.' }).trim().max(20_000, 'Description must be 20000 characters or fewer.').default(''),
})

const coreInput = ticketTextInput.extend({
  priority: z.enum(PRIORITIES, { error: 'Must be one of the options.' }).default('normal'),
})

const typeInput = z.object({
  ticket_type_id: z.number({ error: 'Choose a Ticket Type.' }).int('Choose a Ticket Type.').positive('Choose a Ticket Type.'),
  fields: z.record(z.string(), z.unknown(), { error: 'Must be an object keyed by Field Key.' }).default({}),
})

const UPDATABLE = { status: 'change_status', priority: 'change_priority', assignee_id: 'assign', fields: 'edit_fields' } as const satisfies Record<string, TicketAction>

const updateInput = z.strictObject({
  status: z.string({ error: 'Must be a Status key.' }).min(1, 'Must be a Status key.').optional(),
  priority: z.enum(PRIORITIES, { error: 'Must be one of the options.' }).optional(),
  assignee_id: z.string({ error: 'Must be a User ID, or null to unassign.' }).min(1, 'Must be a User ID, or null to unassign.').nullable().optional(),
  // Only the Fields that are sent change. An empty value clears the Field.
  fields: z.record(z.string(), z.unknown(), { error: 'Must be an object keyed by Field Key.' }).optional(),
}, {
  error: issue => issue.code === 'unrecognized_keys'
    ? `Only ${Object.keys(UPDATABLE).join(', ')} can change here. Unknown: ${issue.keys.join(', ')}.`
    : 'Must be an object.',
})

const coreLabels: Record<string, string> = {
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
    const key = String(issue.path[0] ?? 'body')
    const error: FieldError = { key, label: coreLabels[key] ?? 'Request body', reason: issue.message }
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
const assignee = alias(user, 'assignee')

const summaryColumns = {
  number: ticket.number,
  title: ticket.title,
  priority: ticket.priority,
  channel: ticket.channel,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  requesterId: ticket.requesterId,
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
  teamId: team.id,
  teamName: team.name,
}

function selectSummaries(db: Db, where: SQL | undefined) {
  return db.select(summaryColumns).from(ticket)
    .innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
    // Left joins, so a row with a missing Status or Team fails loudly in toSummary instead of vanishing from lists.
    .leftJoin(status, eq(ticket.status, status.key))
    .innerJoin(requester, eq(ticket.requesterId, requester.id))
    .leftJoin(assignee, eq(ticket.assigneeId, assignee.id))
    .where(where)
}

function selectDetail(db: Db, number: number) {
  return db.select(detailColumns).from(ticket)
    .innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
    .leftJoin(status, eq(ticket.status, status.key))
    .innerJoin(requester, eq(ticket.requesterId, requester.id))
    .leftJoin(assignee, eq(ticket.assigneeId, assignee.id))
    .leftJoin(team, eq(ticketType.teamId, team.id))
    .where(eq(ticket.number, number))
    .limit(1)
}

type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number]
export type DetailRow = Awaited<ReturnType<typeof selectDetail>>[number]

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
    requester: { id: row.requesterId, name: row.requesterName, email: row.requesterEmail },
    assignee: row.assigneeId === null ? null : { id: row.assigneeId, name: row.assigneeName ?? '', email: row.assigneeEmail ?? '' },
    channel: row.channel,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export function policyFacts(row: Pick<SummaryRow, 'requesterId' | 'visibleToAll'>): PolicyTicket {
  return { requesterId: row.requesterId, visibleToAll: row.visibleToAll }
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
  const [fields, [comments]] = await Promise.all([
    pinnedFields(db, row),
    db.select({ n: count() }).from(comment)
      .where(and(eq(comment.ticketNumber, row.number), canSeeInternal(principal) ? undefined : eq(comment.visibility, 'public'))),
  ])
  return {
    ...toSummary(row),
    description: row.description,
    schema_version: row.schemaVersion,
    fields: row.fields,
    // An archived Field still shows when this ticket has a value for it.
    schema_fields: fields.filter(f => !f.archived || f.key in row.fields).map(f => ({ key: f.key, label: f.label, type: f.type })),
    team: { id: row.teamId, name: row.teamName },
    comment_count: comments!.n,
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

/**
 * Creates a ticket of the chosen type, pinned to the type's newest Schema Version, with Status `open`.
 * Throws TicketValidationError with every problem at once: core attributes and Field values.
 */
export async function createTicket(db: Db, principal: Principal, input: unknown): Promise<TicketDetail> {
  const core = coreInput.safeParse(input)
  const target = typeInput.safeParse(input)
  const errors = [...(core.success ? [] : coreErrors(core.error.issues)), ...(target.success ? [] : coreErrors(target.error.issues))]

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
  // last_insert_rowid() is the new ticket: the audit entry is the next statement of the same batch.
  // The new ticket has the highest number: D1 runs one batch at a time.
  const [created] = await db.batch(withEvent(db, principal, { type: 'ticket.created', ticketNumber: sql`(SELECT max(number) FROM ticket)` }, [db.insert(ticket).values({
    ticketTypeId: found.type.id,
    schemaVersion: found.version.version,
    title: core.data.title,
    description: core.data.description,
    priority: core.data.priority,
    fields: values,
    requesterId: principal.userId,
    channel: principal.channel,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }).returning({ number: ticket.number }),
  auditEntry(db, principal, { ticketNumber: sql`last_insert_rowid()`, action: 'ticket_created' }),
  ])) as [{ number: number }[]]
  return getTicket(db, principal, created[0]!.number)
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
  const assignee = filter.assignee === 'me' ? principal.userId : filter.assignee
  return and(
    readableTickets(principal),
    filter.requesterIsMe ? eq(ticket.requesterId, principal.userId) : undefined,
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
      .where(where)
      .groupBy(ticket.status),
  ])
  const page = rows.slice(0, limit)
  return {
    tickets: page.map(toSummary),
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
  return rows.map(toSummary)
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
  action: Extract<AuditAction, 'status_changed' | 'priority_changed' | 'assignee_changed' | 'field_changed'>
  fieldKey?: string
  before: unknown
  after: unknown
  revertsId?: number
}

/** Writes the change, one audit entry for each value, and the outbox Event in one batch. Every change to a ticket goes through here. */
export async function applyChange(db: Db, principal: Principal, number: number, set: Partial<typeof ticket.$inferInsert>, entries: ChangeEntry[]) {
  await db.batch(withEvent(db, principal, { type: 'ticket.updated', ticketNumber: number, changed: entries.map(changedKey) }, [
    db.update(ticket).set({ ...set, updatedAt: new Date() }).where(eq(ticket.number, number)),
    ...entries.map(e => auditEntry(db, principal, {
      ticketNumber: number,
      action: e.action,
      fieldKey: e.fieldKey,
      revertsId: e.revertsId,
      values: { before: e.before, after: e.after },
    })),
  ]))
}
