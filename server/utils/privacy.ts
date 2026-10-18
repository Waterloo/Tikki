import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { application, attachment, auditLog, comment, contact, idempotencyKey, notification, notificationMail, outboxEvent, ticket, ticketType, uploadLink, user, webhookDelivery } from '../db/schema'
import { actor, auditEntry } from './audit'
import type { Db } from './auth'
import { authorizeErasure, authorizeRestore, NO_CONTACT, NOT_FOUND, PolicyRefusal } from './policy'
import { getTicket, loadFor, type Principal, type TicketDetail } from './tickets'

/*
 * Issue 22: soft delete (Admins hide a ticket and can restore it) and Erasure of a Contact's personal data (9.2).
 */

/** Hides the ticket from every channel. No Event: the read rule hides it, and a receiver gets nothing new for it. */
export async function deleteTicket(db: Db, principal: Principal, number: number): Promise<void> {
  await loadFor(db, principal, 'delete', number)
  await db.batch([
    db.update(ticket).set({ deletedAt: new Date() }).where(eq(ticket.number, number)),
    auditEntry(db, principal, { ticketNumber: number, action: 'ticket_deleted' }),
  ])
}

/** Makes a deleted ticket visible again, as it was. Only Admins; for anyone else the ticket does not exist. */
export async function restoreTicket(db: Db, principal: Principal, number: number): Promise<TicketDetail> {
  const refusal = authorizeRestore(principal)
  if (refusal) throw new PolicyRefusal(refusal)
  const [row] = await db.select({ deletedAt: ticket.deletedAt }).from(ticket).where(eq(ticket.number, number)).limit(1)
  if (!row?.deletedAt) throw new PolicyRefusal(NOT_FOUND)
  await db.batch([
    db.update(ticket).set({ deletedAt: null }).where(eq(ticket.number, number)),
    auditEntry(db, principal, { ticketNumber: number, action: 'ticket_restored' }),
  ])
  return getTicket(db, principal, number)
}

export interface DeletedTicketView {
  number: number
  ref: string
  title: string
  ticket_type: { name: string, icon: string, color: string }
  deleted_at: string
  /** The Admin who deleted it, from the audit log. */
  deleted_by: { id: string, name: string } | null
}

export const DELETED_LIMIT = 200

/** The newest deleted tickets, for the one place where Admins see them. The caller checks `authorizeRestore`. */
export async function listDeletedTickets(db: Db): Promise<DeletedTicketView[]> {
  const by = alias(user, 'deleted_by')
  const rows = await db.select({
    number: ticket.number, title: ticket.title, deletedAt: ticket.deletedAt,
    prefix: ticketType.prefix, typeName: ticketType.name, typeIcon: ticketType.icon, typeColor: ticketType.color,
    byId: by.id, byName: by.name, byEmail: by.email,
  }).from(ticket)
    .innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
    .leftJoin(by, eq(by.id, sql`(SELECT a.principal_id FROM audit_log a WHERE a.ticket_number = ${ticket.number} AND a.action = 'ticket_deleted' ORDER BY a.id DESC LIMIT 1)`))
    .where(isNotNull(ticket.deletedAt))
    .orderBy(desc(ticket.deletedAt), desc(ticket.number))
    .limit(DELETED_LIMIT)
  return rows.map(r => ({
    number: r.number,
    ref: `${r.prefix}-${r.number}`,
    title: r.title,
    ticket_type: { name: r.typeName, icon: r.typeIcon, color: r.typeColor },
    deleted_at: r.deletedAt!.toISOString(),
    deleted_by: r.byId === null ? null : { id: r.byId, name: r.byName?.trim() || r.byEmail! },
  }))
}

// Erasure

/** What replaces erased text. The tickets stay, so a placeholder reads better than an empty title. */
export const ERASED = '[erased]'

export interface ContactMatch {
  id: number
  external_id: string
  name: string
  email: string
  application: { id: number, name: string }
  ticket_count: number
  erased_at: string | null
}

export interface ContactSearch {
  contacts: ContactMatch[]
  /** Users with this email. Erasure is for Contacts only, so the page explains what to do instead. */
  users: { id: string, name: string, email: string }[]
}

/** Contacts (of any Application) with this email or external ID, for Admins. Exact match; email ignores case. */
export async function findContacts(db: Db, query: { email?: string, externalId?: string }): Promise<ContactSearch> {
  const email = query.email?.trim().toLowerCase()
  const externalId = query.externalId?.trim()
  const where = email ? sql`lower(${contact.email}) = ${email}` : eq(contact.externalId, externalId ?? '')
  const [contacts, users] = await Promise.all([
    db.select({
      id: contact.id, externalId: contact.externalId, name: contact.name, email: contact.email, erasedAt: contact.erasedAt,
      appId: application.id, appName: application.name,
      tickets: sql<number>`(SELECT count(*) FROM ticket t WHERE t.contact_id = ${contact.id})`,
    }).from(contact).innerJoin(application, eq(application.id, contact.applicationId)).where(where).orderBy(contact.id).limit(50),
    email ? db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(sql`lower(${user.email}) = ${email}`) : Promise.resolve([]),
  ])
  return {
    contacts: contacts.map(c => ({
      id: c.id, external_id: c.externalId, name: c.name, email: c.email,
      application: { id: c.appId, name: c.appName }, ticket_count: c.tickets, erased_at: c.erasedAt?.toISOString() ?? null,
    })),
    users,
  }
}

const R2_DELETE_MAX = 1000

/**
 * Erases one Contact (9.2). The tickets stay with their numbers, Statuses and audit facts; every value is removed.
 *
 * D1 has no interactive transactions and R2 cannot join a batch, so the order is:
 * 1. One `db.batch`: the Contact, the ticket text, Field values, comment bodies, audit values, file names, outbox
 *    payloads, notices and Upload Links. The files are marked erased in the same batch, so no route serves them after it.
 * 2. Delete the R2 objects of every erased file of these tickets.
 * If step 2 fails, the files are already unreachable, and calling this again (it is idempotent) deletes them.
 */
export async function eraseContact(db: Db, bucket: R2Bucket, principal: Principal, contactId: number): Promise<void> {
  const [found] = await db.select({ applicationId: contact.applicationId }).from(contact).where(eq(contact.id, contactId)).limit(1)
  if (!found) throw new PolicyRefusal(NO_CONTACT)
  const refusal = authorizeErasure(principal, found.applicationId)
  if (refusal) throw new PolicyRefusal(refusal)

  const now = new Date()
  const tickets = db.select({ number: ticket.number }).from(ticket).where(eq(ticket.contactId, contactId))
  const of = (column: SQLiteColumn) => inArray(column, tickets)
  const who = actor(principal)

  await db.batch([
    // The external ID too: it may be personal (an email), and a new ticket with the old ID must make a new Contact.
    db.update(contact).set({ name: ERASED, email: ERASED, externalId: `${ERASED}:${contactId}`, erasedAt: sql`coalesce(${contact.erasedAt}, ${now.getTime()})`, updatedAt: now }).where(eq(contact.id, contactId)),
    db.update(ticket).set({ title: ERASED, description: '', fields: {} }).where(eq(ticket.contactId, contactId)),
    db.update(comment).set({ body: ERASED }).where(of(comment.ticketNumber)),
    db.update(auditLog).set({ before: null, after: null }).where(of(auditLog.ticketNumber)),
    db.update(attachment).set({ filename: '', erasedAt: sql`coalesce(${attachment.erasedAt}, ${now.getTime()})` }).where(of(attachment.ticketNumber)),
    db.delete(uploadLink).where(of(uploadLink.ticketNumber)),
    // The body hash of the create is derived from the Contact's data.
    db.delete(idempotencyKey).where(of(idempotencyKey.ticketNumber)),
    // Notices build their text from the ticket, but they are not facts to keep; the Inbox loses them.
    db.delete(notificationMail).where(inArray(notificationMail.notificationId, db.select({ id: notification.id }).from(notification).where(of(notification.ticketNumber)))),
    db.delete(notification).where(of(notification.ticketNumber)),
    // Payloads hold the ticket and comment text. Pending deliveries go too: they would send erased data.
    db.delete(webhookDelivery).where(inArray(webhookDelivery.eventId, db.select({ id: outboxEvent.id }).from(outboxEvent).where(of(outboxEvent.ticketNumber)))),
    db.delete(outboxEvent).where(of(outboxEvent.ticketNumber)),
    // The fact of the Erasure, without values. After the audit update, which would not change it anyway.
    db.insert(auditLog).select(sql`SELECT NULL, t.number, NULL, NULL, ${who.principalId}, ${who.applicationId}, ${principal.channel},
      'ticket_erased', NULL, NULL, NULL, ${who.ticketAppId}, NULL, NULL, ${now.getTime()} FROM ticket t WHERE t.contact_id = ${contactId}`),
  ])

  const files = await db.select({ id: attachment.id }).from(attachment).where(and(of(attachment.ticketNumber), isNotNull(attachment.erasedAt)))
  for (let i = 0; i < files.length; i += R2_DELETE_MAX) {
    await bucket.delete(files.slice(i, i + R2_DELETE_MAX).map(f => f.id))
  }
}
