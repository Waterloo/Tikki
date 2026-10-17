import { and, desc, eq, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { PRIORITIES, ticket, ticketType, type Priority } from '../db/schema'
import type { Db, Role } from './auth'
import { validateFields, type FieldError, type FieldValues } from './fields'
import { loadTicketType } from './ticket-types'

export type Channel = 'web' | 'ai' | 'api'

/** Who acts. `channel: 'ai'` is a User acting through Claude, with the same rights as the User (5.1). */
export interface Principal {
  userId: string
  role: Role
  channel: Channel
}

export interface TicketView {
  number: number
  ref: string
  title: string
  description: string
  priority: Priority
  ticket_type: { id: number, name: string, prefix: string }
  schema_version: number
  fields: FieldValues
  requester_id: string
  channel: Channel
  created_at: string
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

const coreLabels: Record<string, string> = { title: 'Title', description: 'Description', priority: 'Priority', ticket_type_id: 'Ticket Type', fields: 'Fields' }

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

function canSeeAll(principal: Principal) {
  return principal.role === 'admin' || principal.role === 'agent'
}

const columns = {
  number: ticket.number,
  title: ticket.title,
  description: ticket.description,
  priority: ticket.priority,
  schemaVersion: ticket.schemaVersion,
  fields: ticket.fields,
  requesterId: ticket.requesterId,
  channel: ticket.channel,
  createdAt: ticket.createdAt,
  typeId: ticketType.id,
  typeName: ticketType.name,
  prefix: ticketType.prefix,
}

type Row = Awaited<ReturnType<typeof select>>[number]

function toView(row: Row): TicketView {
  return {
    number: row.number,
    ref: `${row.prefix}-${row.number}`,
    title: row.title,
    description: row.description,
    priority: row.priority,
    ticket_type: { id: row.typeId, name: row.typeName, prefix: row.prefix },
    schema_version: row.schemaVersion,
    fields: row.fields,
    requester_id: row.requesterId,
    channel: row.channel,
    created_at: row.createdAt.toISOString(),
  }
}

function select(db: Db, where: SQL | undefined) {
  return db.select(columns).from(ticket).innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id)).where(where)
}

/**
 * Creates a ticket of the chosen type, pinned to the type's newest Schema Version.
 * Throws TicketValidationError with every problem at once: core attributes and Field values.
 */
export async function createTicket(db: Db, principal: Principal, input: unknown): Promise<TicketView> {
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

  const [created] = await db.insert(ticket).values({
    ticketTypeId: found.type.id,
    schemaVersion: found.version.version,
    title: core.data.title,
    description: core.data.description,
    priority: core.data.priority,
    fields: values,
    requesterId: principal.userId,
    channel: principal.channel,
  }).returning()
  return toView({ ...created!, typeId: found.type.id, typeName: found.type.name, prefix: found.type.prefix })
}

/** Tickets the Principal can see, newest first. `requesterIsMe` limits them to the Principal's own tickets. */
export async function listTickets(db: Db, principal: Principal, opts: { requesterIsMe?: boolean } = {}): Promise<TicketView[]> {
  const own = eq(ticket.requesterId, principal.userId)
  const where = opts.requesterIsMe || !canSeeAll(principal) ? own : undefined
  const rows = await select(db, where).orderBy(desc(ticket.number)).limit(100)
  return rows.map(toView)
}

/** The ticket, or null when it does not exist or the Principal cannot see it. */
export async function getTicket(db: Db, principal: Principal, number: number): Promise<TicketView | null> {
  const byNumber = eq(ticket.number, number)
  const where = canSeeAll(principal) ? byNumber : and(byNumber, eq(ticket.requesterId, principal.userId))
  const [row] = await select(db, where).limit(1)
  return row ? toView(row) : null
}
