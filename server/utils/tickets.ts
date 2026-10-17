import { and, asc, desc, eq, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { ticket, ticketType } from '../db/schema'
import type { Db, Role } from './auth'

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
  ticket_type: { name: string, prefix: string }
  requester_id: string
  channel: Channel
  created_at: string
}

export const newTicketInput = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200, 'Title must be 200 characters or fewer.'),
  description: z.string().trim().max(20_000, 'Description must be 20000 characters or fewer.').default(''),
})
export type NewTicketInput = z.input<typeof newTicketInput>

export class TicketValidationError extends Error {
  constructor(readonly details: { field: string, reason: string }[]) {
    super(details.map(d => `${d.field}: ${d.reason}`).join(' '))
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
  requesterId: ticket.requesterId,
  channel: ticket.channel,
  createdAt: ticket.createdAt,
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
    ticket_type: { name: row.typeName, prefix: row.prefix },
    requester_id: row.requesterId,
    channel: row.channel,
    created_at: row.createdAt.toISOString(),
  }
}

function select(db: Db, where: SQL | undefined) {
  return db.select(columns).from(ticket).innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id)).where(where)
}

export async function createTicket(db: Db, principal: Principal, input: unknown): Promise<TicketView> {
  const parsed = newTicketInput.safeParse(input)
  if (!parsed.success) {
    throw new TicketValidationError(parsed.error.issues.map(i => ({ field: i.path.join('.') || 'body', reason: i.message })))
  }
  // Until issue 03 adds a type choice, every ticket gets the first Ticket Type (the seeded Bug).
  const [type] = await db.select().from(ticketType).orderBy(asc(ticketType.id)).limit(1)
  if (!type) throw new Error('No Ticket Type exists. The first migration seeds one; check that migrations ran.')
  const [created] = await db.insert(ticket).values({
    ticketTypeId: type.id,
    title: parsed.data.title,
    description: parsed.data.description,
    requesterId: principal.userId,
    channel: principal.channel,
  }).returning()
  return toView({ ...created!, typeName: type.name, prefix: type.prefix })
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
