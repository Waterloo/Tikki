import { and, asc, eq, isNull, notInArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ticketParticipant, user } from '../db/schema'
import { auditEntry } from './audit'
import type { Db } from './auth'
import { NOT_FOUND, PolicyRefusal } from './policy'
import { loadFor, TicketValidationError, type DetailRow, type PersonView, type UserPrincipal } from './tickets'

/*
 * Participants of a ticket (issue 27, glossary). The Requester and the assignee are Participants by rule and have no row;
 * a row is a User someone added. Only Restricted tickets take added Participants; the read rule in policy.ts uses them.
 */

export interface ParticipantView extends PersonView {
  /** Why the User is a Participant without a row. Null: only added. */
  by_rule: 'requester' | 'assignee' | null
  /** Has a row, so it can be removed. An assignee who was also added stays a Participant after unassign. */
  added: boolean
}

const addInput = z.strictObject({
  user_id: z.string({ error: 'Must be a User ID.' }).min(1, 'Must be a User ID.'),
}, { error: () => 'Send { user_id }.' })

const CANDIDATE_LIMIT = 10

async function participantsOf(db: Db, row: DetailRow): Promise<ParticipantView[]> {
  const added = await db.select({ id: user.id, name: user.name, email: user.email }).from(ticketParticipant)
    .innerJoin(user, eq(user.id, ticketParticipant.userId))
    .where(eq(ticketParticipant.ticketNumber, row.number)).orderBy(asc(ticketParticipant.addedAt))
  const addedIds = new Set(added.map(a => a.id))
  const list: ParticipantView[] = []
  // A Contact's ticket has no User Requester.
  if (row.requesterId !== null) list.push({ id: row.requesterId, name: row.requesterName ?? '', email: row.requesterEmail ?? '', by_rule: 'requester', added: false })
  if (row.assigneeId !== null && row.assigneeId !== row.requesterId) {
    list.push({ id: row.assigneeId, name: row.assigneeName ?? '', email: row.assigneeEmail ?? '', by_rule: 'assignee', added: addedIds.has(row.assigneeId) })
  }
  for (const a of added) if (!list.some(p => p.id === a.id)) list.push({ ...a, by_rule: null, added: true })
  return list
}

/** The Participants, for every User who can read the ticket. */
export async function listParticipants(db: Db, principal: UserPrincipal, number: number): Promise<ParticipantView[]> {
  return participantsOf(db, await loadFor(db, principal, 'read', number))
}

/** Active Users whose name or email has `query`, who are not Participants yet. For the add picker. */
export async function participantCandidates(db: Db, principal: UserPrincipal, number: number, query: string): Promise<PersonView[]> {
  const row = await loadFor(db, principal, 'manage_participants', number)
  const current = (await participantsOf(db, row)).filter(p => p.added || p.by_rule === 'requester').map(p => p.id)
  const q = query.trim().slice(0, 100)
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  return db.select({ id: user.id, name: user.name, email: user.email }).from(user)
    .where(and(
      isNull(user.deactivatedAt),
      current.length ? notInArray(user.id, current) : undefined,
      q ? or(sql`${user.name} LIKE ${pattern} ESCAPE '\\'`, sql`${user.email} LIKE ${pattern} ESCAPE '\\'`) : undefined,
    ))
    .orderBy(asc(user.name), asc(user.email)).limit(CANDIDATE_LIMIT)
}

/** Adds an active User. The assignee can be added too, so they keep the ticket after unassign. */
export async function addParticipant(db: Db, principal: UserPrincipal, number: number, input: unknown): Promise<ParticipantView[]> {
  const row = await loadFor(db, principal, 'manage_participants', number)
  const parsed = addInput.safeParse(input)
  const problem = (reason: string) => new TicketValidationError([{ key: 'user_id', label: 'Participant', reason }])
  if (!parsed.success) throw problem(parsed.error.issues[0]!.message)
  const userId = parsed.data.user_id
  const [target] = await db.select({ deactivatedAt: user.deactivatedAt }).from(user).where(eq(user.id, userId)).limit(1)
  if (!target) throw problem('No User has this ID.')
  if (target.deactivatedAt !== null) throw problem('This User is deactivated.')
  if (userId === row.requesterId) throw problem('The Requester is always a Participant.')

  try {
    await db.batch([
      db.insert(ticketParticipant).values({ ticketNumber: number, userId, addedBy: principal.userId, addedAt: new Date() }),
      auditEntry(db, principal, { ticketNumber: number, action: 'participant_added', values: { before: null, after: userId } }),
    ])
  } catch (error) {
    // The primary key refuses a second row, also for two adds at the same time; the batch then writes nothing.
    if (isUniqueViolation(error)) throw problem('This User is already a Participant.')
    throw error
  }
  return participantsOf(db, await loadFor(db, principal, 'read', number))
}

/** Removes an added User. The Requester and the assignee stay Participants by rule. */
export async function removeParticipant(db: Db, principal: UserPrincipal, number: number, userId: string): Promise<ParticipantView[]> {
  const row = await loadFor(db, principal, 'manage_participants', number)
  const [found] = await db.select({ userId: ticketParticipant.userId }).from(ticketParticipant)
    .where(and(eq(ticketParticipant.ticketNumber, number), eq(ticketParticipant.userId, userId))).limit(1)
  if (!found) {
    const reason = userId === row.requesterId || userId === row.assigneeId ? 'The Requester and the assignee are Participants by rule. Unassign the ticket instead.' : 'This User was not added to the ticket.'
    throw new PolicyRefusal({ ...NOT_FOUND, message: reason })
  }
  await db.batch([
    db.delete(ticketParticipant).where(and(eq(ticketParticipant.ticketNumber, number), eq(ticketParticipant.userId, userId))),
    auditEntry(db, principal, { ticketNumber: number, action: 'participant_removed', values: { before: userId, after: null } }),
  ])
  // The actor stays a Participant: only the Requester, the assignee and Admins remove, and they keep the ticket by rule.
  return participantsOf(db, await loadFor(db, principal, 'read', number))
}

function isUniqueViolation(error: unknown): boolean {
  for (let e = error as { message?: string, cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.message?.includes('UNIQUE constraint failed')) return true
  }
  return false
}
