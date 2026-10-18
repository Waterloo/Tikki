import { and, desc, eq, sql } from 'drizzle-orm'
import { auditLog, comment, ticket } from '../db/schema'
import { commentAuthor } from './activity'
import { auditEntry } from './audit'
import type { Db } from './auth'
import { applyChange, getTicket, loadFor, type Principal, type TicketDetail } from './tickets'

/** The reason of a cancel by the Requester (4.21). */
export const CANCEL_REASON = 'cancelled by requester'
/** After this time a reopen creates a new ticket (4.22). */
export const REOPEN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The Requester cancels their ticket: Status `closed`. The reason is in two places: the `ticket_cancelled` audit
 * entry (facts only) and a Public Comment, so the Agent sees it in the conversation. All in one batch.
 * `now` is a parameter so tests need no sleep.
 */
export async function cancelTicket(db: Db, principal: Principal, number: number, now = new Date()): Promise<TicketDetail> {
  const row = await loadFor(db, principal, 'cancel', number)
  const id = crypto.randomUUID()
  await applyChange(db, principal, number, { status: 'closed' }, [{ action: 'ticket_cancelled', before: row.statusKey, after: 'closed' }], [
    db.insert(comment).values({ id, ticketNumber: number, ...commentAuthor(principal), channel: principal.channel, visibility: 'public', body: `Ticket ${CANCEL_REASON}.`, createdAt: now }),
    auditEntry(db, principal, { ticketNumber: number, action: 'comment_added', commentId: id }),
  ], now)
  return getTicket(db, principal, number)
}

/**
 * Reopens a resolved ticket. Within 14 days of the resolution the same ticket returns to `open`. After that a new
 * ticket is created with the same content and `reopened_from` set to the old one. `created` tells which.
 */
export async function reopenTicket(db: Db, principal: Principal, number: number, now = new Date()): Promise<{ ticket: TicketDetail, created: boolean }> {
  const row = await loadFor(db, principal, 'reopen', number)
  // The resolution time is the latest change to `resolved` in the audit log.
  const [resolved] = await db.select({ at: auditLog.createdAt }).from(auditLog)
    .where(and(eq(auditLog.ticketNumber, number), eq(auditLog.action, 'status_changed'), eq(auditLog.after, JSON.stringify('resolved'))))
    .orderBy(desc(auditLog.id)).limit(1)
  if (!resolved) throw new Error(`Ticket ${number} is resolved but has no entry that resolved it.`)

  if (now.getTime() - resolved.at.getTime() <= REOPEN_WINDOW_MS) {
    await applyChange(db, principal, number, { status: 'open' }, [{ action: 'ticket_reopened', before: row.statusKey, after: 'open' }], [], now)
    return { ticket: await getTicket(db, principal, number), created: false }
  }

  // last_insert_rowid() is the new ticket: its creation entry is the next statement of the batch.
  const [created] = await db.batch([
    db.insert(ticket).values({
      ticketTypeId: row.typeId,
      // The Team of the type, as for any new ticket (4.13a).
      teamId: sql`(SELECT team_id FROM ticket_type WHERE id = ${row.typeId})`,
      // The same Schema Version, so the copied Field values stay valid.
      schemaVersion: row.schemaVersion,
      title: row.title,
      description: row.description,
      priority: row.priority,
      fields: row.fields,
      // The policy lets only the Requester reopen, so this is the Principal's own Requester row.
      requesterId: row.requesterId,
      contactId: row.contactId,
      channel: principal.channel,
      status: 'open',
      reopenedFrom: number,
      createdAt: now,
      updatedAt: now,
    }).returning({ number: ticket.number }),
    auditEntry(db, principal, { ticketNumber: sql`last_insert_rowid()`, action: 'ticket_created', values: { before: null, after: number } }),
    auditEntry(db, principal, { ticketNumber: number, action: 'ticket_reopened' }),
  ])
  return { ticket: await getTicket(db, principal, created[0]!.number), created: true }
}
