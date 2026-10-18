import { and, count, desc, eq, isNull, lt, ne, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { application, comment, contact, notification, notificationPreference, PREFERENCE_KEYS, ticket, ticketType, user, type NotificationKind, type PreferenceKey } from '../db/schema'
import type { Db } from './auth'
import { canReadInternalComments } from './policy'
import type { ChangeEntry, UserPrincipal } from './tickets'

/*
 * Notices (8.10, Q31). Each writer returns statements for the `db.batch([...])` of the change, so a change and its
 * notices are stored together or not at all. The actor never gets a notice about their own change. Recipients are
 * chosen inside SQL, so a write costs a constant number of statements.
 * `actorId` is null when an Application acts (`IS NOT` keeps every recipient then). A Contact is no User: the
 * `IS NOT NULL` conditions keep a Contact's ticket from writing a notice without a recipient.
 */

/**
 * INSERT ... SELECT, so the recipients are chosen in SQL. D1 batches only accept query builders, not `db.run`.
 * The SELECT gives every column of the table, in order: id, user_id, kind, ticket_number, comment_id, actor_id, data, read_at, created_at.
 */
function insertSelect(db: Db, select: SQL) {
  return db.insert(notification).select(select)
}

/**
 * After the audit entry of a new ticket (it needs `last_insert_rowid()` to be that entry).
 * Owning Team: there is no Team membership yet (issue 20), so every Agent and Admin gets it. When membership exists,
 * join it here on the Team of the ticket's type. The Requester gets no confirmation: a User Requester is the actor,
 * and a Contact has no Inbox (its Application learns of the ticket from the create answer).
 */
export function noticeTicketCreated(db: Db, actorId: string | null) {
  return insertSelect(db, sql`
    SELECT NULL, u.id, 'ticket_created', a.ticket_number, NULL, ${actorId}, NULL, NULL, ${Date.now()}
    FROM user u, audit_log a
    JOIN ticket t ON t.number = a.ticket_number
    JOIN ticket_type tt ON tt.id = t.ticket_type_id
    WHERE a.id = last_insert_rowid() AND u.id IS NOT ${actorId} AND u.deactivated_at IS NULL AND u.role IN ('admin', 'agent')
      AND (u.id IN (SELECT tm.user_id FROM team_member tm WHERE tm.team_id = tt.team_id)
        -- A Team without members (a new install) must not drop the notice: then every Agent and Admin gets it.
        OR NOT EXISTS (SELECT 1 FROM team_member tm WHERE tm.team_id = tt.team_id))`)
}

/** For the entries of `applyChange`: a new assignee is told, and the Requester is told of a new Status. */
export function noticesForChange(db: Db, actorId: string | null, number: number, entries: ChangeEntry[]) {
  const now = Date.now()
  const statements = []
  for (const e of entries) {
    if (e.action === 'assignee_changed' && typeof e.after === 'string' && e.after !== actorId) {
      statements.push(db.insert(notification).values({ userId: e.after, kind: 'assigned', ticketNumber: number, actorId, createdAt: new Date(now) }))
    }
    if (e.action === 'status_changed') {
      statements.push(insertSelect(db, sql`
        SELECT NULL, t.requester_id, 'status_changed', t.number, NULL, ${actorId},
          json_object('status', (SELECT name FROM status WHERE key = ${String(e.after)})), NULL, ${now}
        FROM ticket t WHERE t.number = ${number} AND t.requester_id IS NOT NULL AND t.requester_id IS NOT ${actorId}`))
    }
  }
  return statements
}

/** A Public Comment goes to the Requester and the assignee. An Internal Comment goes to the assignee only. */
export function noticeComment(db: Db, actorId: string | null, number: number, commentId: string, visibility: 'public' | 'internal') {
  if (visibility === 'internal') {
    return insertSelect(db, sql`
      SELECT NULL, t.assignee_id, 'internal_comment', t.number, ${commentId}, ${actorId}, NULL, NULL, ${Date.now()}
      FROM ticket t WHERE t.number = ${number} AND t.assignee_id IS NOT NULL AND t.assignee_id IS NOT ${actorId}`)
  }
  return insertSelect(db, sql`
    SELECT NULL, r.id, 'public_comment', ${number}, ${commentId}, ${actorId}, NULL, NULL, ${Date.now()}
    FROM (
      SELECT requester_id AS id FROM ticket WHERE number = ${number}
      UNION SELECT assignee_id FROM ticket WHERE number = ${number}
    ) r WHERE r.id IS NOT NULL AND r.id IS NOT ${actorId}`)
}

export interface AdminNotice {
  head: string
  body: string
  /** An app path, for example `/settings/webhooks`. */
  href: string
}

/** A notice for every Admin. Issue 14 calls this when an endpoint starts to fail or is disabled (8.7). */
export async function notifyAdmins(db: Db, kind: Extract<NotificationKind, 'webhook_failing' | 'webhook_disabled'>, notice: AdminNotice) {
  const now = Date.now()
  await insertSelect(db, sql`
    SELECT NULL, id, ${kind}, NULL, NULL, NULL, ${JSON.stringify(notice)}, NULL, ${now} FROM user WHERE role = 'admin'`)
}

// Reading

/** The Internal Comment notice is for staff only, even if a User lost the role after it was written. */
function mine(principal: UserPrincipal): SQL {
  return and(
    eq(notification.userId, principal.userId),
    canReadInternalComments(principal) ? undefined : ne(notification.kind, 'internal_comment'),
  )!
}

export async function unreadCount(db: Db, principal: UserPrincipal): Promise<number> {
  const [row] = await db.select({ n: count() }).from(notification).where(and(mine(principal), isNull(notification.readAt)))
  return row?.n ?? 0
}

export interface NoticeView {
  id: number
  kind: NotificationKind
  head: string
  body: string
  href: string
  read: boolean
  created_at: string
  ticket: { ref: string, ticket_type: { name: string, icon: string, color: string }, priority: string } | null
}

export const NOTICE_PAGE = 50
const EXCERPT = 200

const name = (p: { name: string, email: string }) => p.name.trim() || p.email

export async function listNotices(db: Db, principal: UserPrincipal, options: { unreadOnly?: boolean, cursor?: number, limit?: number } = {}) {
  const limit = Math.min(options.limit ?? NOTICE_PAGE, 100)
  const where = and(mine(principal), options.unreadOnly ? isNull(notification.readAt) : undefined, options.cursor ? lt(notification.id, options.cursor) : undefined)
  const actor = alias(user, 'actor')
  const rows = await db.select({
    id: notification.id,
    kind: notification.kind,
    data: notification.data,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
    number: ticket.number,
    title: ticket.title,
    priority: ticket.priority,
    prefix: ticketType.prefix,
    typeName: ticketType.name,
    typeIcon: ticketType.icon,
    typeColor: ticketType.color,
    commentBody: comment.body,
    actorName: actor.name,
    actorEmail: actor.email,
    // A notice without an actor on a Contact's ticket came from its Application: it acts only on its own tickets.
    applicationName: application.name,
  }).from(notification)
    .leftJoin(ticket, eq(ticket.number, notification.ticketNumber))
    .leftJoin(ticketType, eq(ticketType.id, ticket.ticketTypeId))
    .leftJoin(comment, eq(comment.id, notification.commentId))
    .leftJoin(actor, eq(actor.id, notification.actorId))
    .leftJoin(contact, eq(contact.id, ticket.contactId))
    .leftJoin(application, eq(application.id, contact.applicationId))
    .where(where).orderBy(desc(notification.id)).limit(limit + 1)

  const page = rows.slice(0, limit)
  const data: NoticeView[] = page.map((r) => {
    const who = r.actorName !== null ? name({ name: r.actorName, email: r.actorEmail! }) : r.applicationName ?? 'Someone'
    const tref = r.number === null ? '' : `${r.prefix}-${r.number}`
    const excerpt = (r.commentBody ?? '').slice(0, EXCERPT)
    const base = { id: r.id, kind: r.kind, read: r.readAt !== null, created_at: r.createdAt.toISOString() }
    const ticketView = r.number === null ? null : { ref: tref, ticket_type: { name: r.typeName!, icon: r.typeIcon!, color: r.typeColor! }, priority: r.priority! }
    const href = `/tickets/${tref}`
    switch (r.kind) {
      case 'ticket_created': return { ...base, head: `${who} created ${tref}`, body: r.title!, href, ticket: ticketView }
      case 'assigned': return { ...base, head: `${who} assigned ${tref} to you`, body: r.title!, href, ticket: ticketView }
      case 'public_comment': return { ...base, head: `${who} replied on ${tref}`, body: excerpt, href, ticket: ticketView }
      case 'internal_comment': return { ...base, head: `${who} added an internal note on ${tref}`, body: excerpt, href, ticket: ticketView }
      case 'status_changed': return { ...base, head: `${who} changed ${tref} to ${r.data?.status ?? 'a new Status'}`, body: r.title!, href, ticket: ticketView }
      default: return { ...base, head: r.data?.head ?? 'A webhook endpoint needs attention', body: r.data?.body ?? '', href: r.data?.href ?? '/', ticket: null }
    }
  })
  return { data, nextCursor: rows.length > limit ? page.at(-1)!.id : null, unreadCount: await unreadCount(db, principal) }
}

export async function markAllRead(db: Db, principal: UserPrincipal) {
  await db.update(notification).set({ readAt: new Date() }).where(and(eq(notification.userId, principal.userId), isNull(notification.readAt)))
}

/** False when the User has no such notice (or it is not theirs). */
export async function markRead(db: Db, principal: UserPrincipal, id: number): Promise<boolean> {
  const [row] = await db.update(notification).set({ readAt: sql`COALESCE(${notification.readAt}, ${Date.now()})` })
    .where(and(eq(notification.id, id), eq(notification.userId, principal.userId))).returning({ id: notification.id })
  return !!row
}

// Preferences. Only email uses them: the Inbox always gets every notice (8.15). Email sending comes with issue 19.

const STAFF_KEYS: PreferenceKey[] = ['team_ticket', 'assigned', 'public_comment', 'internal_comment']
const DEFAULTS: Record<PreferenceKey, boolean> = { team_ticket: true, assigned: true, public_comment: true, internal_comment: false, status_changed: true, webhook: true }

/** The preferences that make sense for the role: a Requester gets no internal notes, assignments or Team tickets. */
export function preferenceKeysFor(role: string): PreferenceKey[] {
  if (role === 'admin') return [...STAFF_KEYS, 'status_changed', 'webhook']
  if (role === 'agent') return [...STAFF_KEYS, 'status_changed']
  return ['public_comment', 'status_changed']
}

export interface PreferenceView { key: PreferenceKey, enabled: boolean, locked: boolean }

export async function getPreferences(db: Db, principal: UserPrincipal): Promise<PreferenceView[]> {
  const rows = await db.select().from(notificationPreference).where(eq(notificationPreference.userId, principal.userId))
  const stored = new Map(rows.map(r => [r.key, r.enabled]))
  return preferenceKeysFor(principal.role).map(key => ({ key, enabled: key === 'assigned' ? true : stored.get(key) ?? DEFAULTS[key], locked: key === 'assigned' }))
}

export class PreferenceError extends Error {
  constructor(readonly key: string, readonly reason: string) {
    super(reason)
    this.name = 'PreferenceError'
  }
}

export async function setPreferences(db: Db, principal: UserPrincipal, input: unknown): Promise<PreferenceView[]> {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length === 0) {
    throw new PreferenceError('body', 'Send an object such as { "public_comment": true }.')
  }
  const allowed = preferenceKeysFor(principal.role)
  const entries = Object.entries(input)
  for (const [key, value] of entries) {
    if (!(PREFERENCE_KEYS as readonly string[]).includes(key) || !allowed.includes(key as PreferenceKey)) throw new PreferenceError(key, `Unknown preference. Known keys: ${allowed.join(', ')}.`)
    if (typeof value !== 'boolean') throw new PreferenceError(key, 'Must be true or false.')
    if (key === 'assigned' && value === false) throw new PreferenceError(key, 'You are always told when a ticket is assigned to you. This cannot be turned off.')
  }
  const writes = entries.filter(([key]) => key !== 'assigned').map(([key, enabled]) => db.insert(notificationPreference)
    .values({ userId: principal.userId, key: key as PreferenceKey, enabled: enabled as boolean })
    .onConflictDoUpdate({ target: [notificationPreference.userId, notificationPreference.key], set: { enabled: enabled as boolean } }))
  if (writes.length) await db.batch(writes as [typeof writes[0], ...typeof writes])
  return getPreferences(db, principal)
}
