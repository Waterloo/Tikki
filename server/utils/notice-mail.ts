import { waitUntil } from 'cloudflare:workers'
import { eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { application, comment, contact, mailStatus, notification, notificationPreference, ticket, ticketType, user, type NotificationKind, type PreferenceKey } from '../db/schema'
import type { Db } from './auth'
import type { MailMessage, MailTransport } from './mail'
import { config } from './env'
import { useMail, db } from './services'
import { DEFAULT_PREFERENCES, noticeText } from './notifications'

/*
 * Notification email (issue 19). It runs after the batch of a change has been stored, in `waitUntil`, so a slow or
 * failing transport never delays, fails or rolls back the change. The Inbox already has every notice (8.15); this only
 * adds email for the Users whose switch is on. Each notice is claimed once in `notification_mail`, so nothing is
 * sent twice and a failed send is not retried in a loop.
 */

/** Which switch controls the email for each kind of notice. */
const PREFERENCE_OF: Record<NotificationKind, PreferenceKey> = {
  ticket_created: 'team_ticket',
  assigned: 'assigned',
  public_comment: 'public_comment',
  internal_comment: 'internal_comment',
  status_changed: 'status_changed',
  webhook_failing: 'webhook',
  webhook_disabled: 'webhook',
}

export interface MailContext {
  /** Null for the `none` transport: nothing is sent. */
  transport: MailTransport | null
  appUrl: string
}

export type NoticeScope = { ticket: number } | { webhook: true }

const esc = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
/** A header must stay on one line. Ticket titles are untrusted. */
const oneLine = (value: string) => value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim().slice(0, 150)

export function renderNoticeEmail(notice: { head: string, body: string, href: string, ref: string | null }, appUrl: string): MailMessage & { html: string } {
  const link = `${appUrl}${notice.href}`
  const text = [notice.head, ...(notice.body ? [notice.body] : []), '', `Open it: ${link}`, '', `You get this email because of your notification settings. Change them in your Inbox: ${appUrl}/inbox`].join('\n')
  const html = `<p><strong>${esc(notice.head)}</strong></p>${notice.body ? `<p>${esc(notice.body)}</p>` : ''}<p><a href="${esc(link)}">Open it</a></p><p style="color:#666;font-size:12px">You get this email because of your notification settings. <a href="${esc(`${appUrl}/inbox`)}">Change them in your Inbox</a>.</p>`
  return { to: '', subject: oneLine(notice.ref ? `[${notice.ref}] ${notice.head}` : notice.head), text, html }
}

/** Marks the notices of the scope that were not handled yet, and returns their IDs. One statement, so two senders never share a notice. */
async function claim(db: Db, scope: NoticeScope): Promise<number[]> {
  const where = 'ticket' in scope
    ? sql`n.ticket_number = ${scope.ticket}`
    : sql`n.kind IN ('webhook_failing', 'webhook_disabled')`
  const rows = await db.all<{ notification_id: number }>(sql`
    INSERT INTO notification_mail (notification_id, at) SELECT n.id, ${Date.now()} FROM notification n
    WHERE ${where} AND NOT EXISTS (SELECT 1 FROM notification_mail m WHERE m.notification_id = n.id)
    RETURNING notification_id`)
  return rows.map(r => r.notification_id)
}

/** Stores or clears the last transport error for Admins. */
export async function recordMailResult(db: Db, error: string | null) {
  if (error === null) {
    await db.update(mailStatus).set({ lastError: null, lastErrorAt: null }).where(eq(mailStatus.id, 1))
    return
  }
  const values = { lastError: error.slice(0, 500), lastErrorAt: new Date() }
  await db.insert(mailStatus).values({ id: 1, ...values }).onConflictDoUpdate({ target: mailStatus.id, set: values })
}

export async function lastMailError(db: Db): Promise<{ message: string, at: string } | null> {
  const [row] = await db.select().from(mailStatus).where(eq(mailStatus.id, 1))
  return row?.lastError && row.lastErrorAt ? { message: row.lastError, at: row.lastErrorAt.toISOString() } : null
}

/**
 * Sends the email for the notices that no one handled yet. Never throws: a failure is logged and stored for Admins.
 * With no transport (`none`) the notices are only marked, so a later switch to a real transport does not send old ones.
 */
export async function sendNoticeMail(db: Db, scope: NoticeScope, ctx: MailContext): Promise<void> {
  try {
    const ids = await claim(db, scope)
    if (!ids.length || !ctx.transport) return

    const actor = alias(user, 'actor')
    const recipient = alias(user, 'recipient')
    const switchOn = sql`CASE ${notification.kind} ${sql.join(
      Object.entries(PREFERENCE_OF).map(([kind, key]) => sql`WHEN ${kind} THEN ${key}`), sql` `)} END`
    const rows = await db.select({
      kind: notification.kind,
      data: notification.data,
      email: recipient.email,
      role: recipient.role,
      enabled: notificationPreference.enabled,
      number: ticket.number,
      title: ticket.title,
      prefix: ticketType.prefix,
      commentBody: comment.body,
      actorName: actor.name,
      actorEmail: actor.email,
      // As in the Inbox: a notice without an actor on a Contact's ticket came from its Application.
      applicationName: application.name,
    }).from(notification)
      .innerJoin(recipient, eq(recipient.id, notification.userId))
      .leftJoin(notificationPreference, sql`${notificationPreference.userId} = ${notification.userId} AND ${notificationPreference.key} = ${switchOn}`)
      .leftJoin(ticket, eq(ticket.number, notification.ticketNumber))
      .leftJoin(ticketType, eq(ticketType.id, ticket.ticketTypeId))
      .leftJoin(comment, eq(comment.id, notification.commentId))
      .leftJoin(actor, eq(actor.id, notification.actorId))
      .leftJoin(contact, eq(contact.id, ticket.contactId))
      .leftJoin(application, eq(application.id, contact.applicationId))
      .where(inArray(notification.id, ids))

    const messages: MailMessage[] = []
    for (const r of rows) {
      if (r.role === 'requester' && r.kind === 'internal_comment') continue
      const key = PREFERENCE_OF[r.kind]
      // "Assigned to me" is always on (issue 18).
      if (key !== 'assigned' && !(r.enabled ?? DEFAULT_PREFERENCES[key])) continue
      const text = noticeText(r)
      messages.push({ ...renderNoticeEmail({ ...text, ref: r.number === null ? null : `${r.prefix}-${r.number}` }, ctx.appUrl), to: r.email })
    }
    if (!messages.length) return

    const results = await Promise.allSettled(messages.map(m => ctx.transport!.send(m)))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) {
      const reason = failed.reason instanceof Error ? failed.reason.message : String(failed.reason)
      console.error(`Notification email failed (${results.filter(r => r.status === 'rejected').length} of ${results.length}): ${reason}`)
      await recordMailResult(db, reason)
    } else {
      await recordMailResult(db, null)
    }
  } catch (error) {
    console.error('Notification email step failed', error)
  }
}

// In-flight sends, so a test can wait for them. On globalThis because tests load their own copy of this module.
const IN_FLIGHT = Symbol.for('ticketing.mailInFlight')
const inFlight = ((globalThis as Record<symbol, Set<Promise<void>>>)[IN_FLIGHT] ??= new Set())

export async function settleNoticeMail() {
  while (inFlight.size) await Promise.all([...inFlight])
}

/** Runs the email step after the response is decided. Call it after the batch of the change succeeded. */
export function queueNoticeMail(scope: NoticeScope) {
  const job = sendNoticeMail(db, scope, { transport: config.mailTransport === 'none' ? null : useMail(), appUrl: config.appUrl }).finally(() => inFlight.delete(job))
  inFlight.add(job)
  waitUntil(job)
}
