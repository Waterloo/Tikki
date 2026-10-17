import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { auditLog, comment, COMMENT_VISIBILITIES, status, ticket, user, type AuditAction, type CommentVisibility } from '../db/schema'
import { auditEntry } from './audit'
import type { Db } from './auth'
import type { FieldDef } from './fields'
import { assertAllowed, authorize, canBeAssignee, canSeeInternal, NOT_FOUND, PolicyRefusal, type TicketAction } from './policy'
import { applyChange, loadFor, pinnedFields, policyFacts, TicketValidationError, type Channel, type ChangeEntry, type DetailRow, type PersonView, type Principal } from './tickets'

export interface CommentView {
  id: string
  visibility: CommentVisibility
  body: string
  author: PersonView
  channel: Channel
  created_at: string
}

/** A refused revert. 409: the entry cannot be reverted now. */
export class RevertRefusal extends Error {
  constructor(readonly code: 'NOT_REVERSIBLE' | 'VALUE_CHANGED', message: string) {
    super(message)
    this.name = 'RevertRefusal'
  }
}

const commentInput = z.object({
  body: z.string({ error: 'Must be text.' }).trim().min(1, 'Write something first.').max(20_000, 'Must be 20000 characters or fewer.'),
  visibility: z.enum(COMMENT_VISIBILITIES, { error: 'Must be public or internal.' }).optional(),
})

const author = { id: user.id, name: user.name, email: user.email }
const commentColumns = { id: comment.id, visibility: comment.visibility, body: comment.body, channel: comment.channel, createdAt: comment.createdAt, authorId: author.id, authorName: author.name, authorEmail: author.email }

function toComment(r: { id: string, visibility: CommentVisibility, body: string, channel: Channel, createdAt: Date, authorId: string, authorName: string, authorEmail: string }): CommentView {
  return { id: r.id, visibility: r.visibility, body: r.body, channel: r.channel, created_at: r.createdAt.toISOString(), author: { id: r.authorId, name: r.authorName, email: r.authorEmail } }
}

/** The condition that hides Internal Comments from a Principal who may not see them. */
function visibleComments(principal: Principal, number: number) {
  return and(eq(comment.ticketNumber, number), canSeeInternal(principal) ? undefined : eq(comment.visibility, 'public'))
}

/**
 * Adds a comment. Without a visibility, an Agent writes an Internal Comment and a Requester a Public one (4.18).
 * The policy decides who may write which kind.
 */
export async function createComment(db: Db, principal: Principal, number: number, input: unknown): Promise<CommentView> {
  const row = await loadFor(db, principal, 'read', number)
  const parsed = commentInput.safeParse(input)
  if (!parsed.success) {
    throw new TicketValidationError(parsed.error.issues.map(i => ({ key: String(i.path[0] ?? 'body'), label: i.path[0] === 'visibility' ? 'Visibility' : 'Comment', reason: i.message })))
  }
  const visibility = parsed.data.visibility ?? (canSeeInternal(principal) ? 'internal' : 'public')
  assertAllowed(principal, visibility === 'internal' ? 'comment_internal' : 'comment', policyFacts(row))

  const id = crypto.randomUUID()
  const now = new Date()
  await db.batch([
    db.insert(comment).values({ id, ticketNumber: number, authorId: principal.userId, channel: principal.channel, visibility, body: parsed.data.body, createdAt: now }),
    auditEntry(db, principal, { ticketNumber: number, action: 'comment_added', commentId: id }),
    db.update(ticket).set({ updatedAt: now }).where(eq(ticket.number, number)),
  ])
  return (await getComment(db, principal, number, id))!
}

/** Only the comments the Principal may see, oldest first. Internal Comments are not in the result for a Requester. */
export async function listComments(db: Db, principal: Principal, number: number): Promise<CommentView[]> {
  await loadFor(db, principal, 'read', number)
  const rows = await db.select(commentColumns).from(comment).innerJoin(user, eq(comment.authorId, user.id))
    .where(visibleComments(principal, number)).orderBy(asc(comment.createdAt), asc(comment.id))
  return rows.map(toComment)
}

/** One comment, or null when it does not exist or the Principal may not see it (the same answer for both). */
export async function getComment(db: Db, principal: Principal, number: number, id: string): Promise<CommentView | null> {
  await loadFor(db, principal, 'read', number)
  const [row] = await db.select(commentColumns).from(comment).innerJoin(user, eq(comment.authorId, user.id))
    .where(and(visibleComments(principal, number), eq(comment.id, id))).limit(1)
  return row ? toComment(row) : null
}

export type ActivityItem =
  | { type: 'comment', id: string, at: string, comment: CommentView }
  | {
    type: 'event'
    id: string
    at: string
    action: Exclude<AuditAction, 'comment_added'>
    principal: PersonView
    channel: Channel
    field: { key: string, label: string } | null
    /** Readable values. Null: no value (a Field not set, or no assignee). */
    before: string | null
    after: string | null
    /** For a type change: the values that did not move, as text. Empty after Erasure. */
    unmoved: { key: string, label: string, value: string }[]
    /** Erasure removed the values (9.2). The entry still says what changed. */
    erased: boolean
    reverts_id: number | null
    /** A later entry reverted this one. */
    reverted: boolean
    /** The Principal may revert it now: the value is still the one this entry set. */
    revertible: boolean
  }

const REVERSIBLE: Partial<Record<AuditAction, TicketAction>> = {
  status_changed: 'change_status',
  priority_changed: 'change_priority',
  assignee_changed: 'assign',
  field_changed: 'edit_fields',
}

function currentValue(row: DetailRow, action: AuditAction, fieldKey: string | null): unknown {
  switch (action) {
    case 'status_changed': return row.statusKey
    case 'priority_changed': return row.priority
    case 'assignee_changed': return row.assigneeId
    default: return row.fields[fieldKey ?? ''] ?? null
  }
}

function unmovedOf(e: { action: string, before: string | null }): { key: string, label: string, value: string }[] {
  if (e.action !== 'type_changed' || e.before === null) return []
  const list = (JSON.parse(e.before) as { unmoved?: { key: string, label: string, value: unknown }[] }).unmoved ?? []
  return list.map(u => ({ key: u.key, label: u.label, value: Array.isArray(u.value) ? u.value.join(', ') : typeof u.value === 'boolean' ? (u.value ? 'Yes' : 'No') : String(u.value) }))
}

const keyOf = (e: { action: string, fieldKey: string | null }) => `${e.action}:${e.fieldKey ?? ''}`

/** The audit log of the ticket mixed with its comments, oldest first. A Requester gets no Internal Comments. */
export async function listActivity(db: Db, principal: Principal, number: number): Promise<ActivityItem[]> {
  const row = await loadFor(db, principal, 'read', number)
  const [entries, comments, statuses, defs] = await Promise.all([
    db.select({
      id: auditLog.id, action: auditLog.action, fieldKey: auditLog.fieldKey, channel: auditLog.channel, revertsId: auditLog.revertsId,
      before: auditLog.before, after: auditLog.after, createdAt: auditLog.createdAt,
      principalId: user.id, principalName: user.name, principalEmail: user.email,
    }).from(auditLog).innerJoin(user, eq(auditLog.principalId, user.id))
      .where(and(eq(auditLog.ticketNumber, number), ne(auditLog.action, 'comment_added'))).orderBy(asc(auditLog.id)),
    db.select(commentColumns).from(comment).innerJoin(user, eq(comment.authorId, user.id))
      .where(visibleComments(principal, number)).orderBy(asc(comment.createdAt), asc(comment.id)),
    db.select({ key: status.key, name: status.name }).from(status),
    pinnedFields(db, row),
  ])

  // One query for the names of all assignees in the log.
  const assigneeIds = new Set<string>()
  for (const e of entries) {
    if (e.action !== 'assignee_changed') continue
    for (const v of [e.before, e.after]) if (v !== null && typeof JSON.parse(v) === 'string') assigneeIds.add(JSON.parse(v))
  }
  const people = assigneeIds.size
    ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, [...assigneeIds]))
    : []
  const statusNames = new Map(statuses.map(s => [s.key, s.name]))
  const personNames = new Map(people.map(p => [p.id, p.name.trim() || p.email]))
  const defByKey = new Map<string, FieldDef>(defs.map(f => [f.key, f]))

  const latest = new Map<string, number>()
  const revertedIds = new Set<number>()
  for (const e of entries) {
    latest.set(keyOf(e), e.id)
    if (e.revertsId !== null) revertedIds.add(e.revertsId)
  }

  function show(e: typeof entries[number], raw: string | null): string | null {
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (value === null) return null
    switch (e.action) {
      // The text of a description is not repeated in the timeline.
      case 'description_changed': return null
      case 'ticket_cancelled':
      case 'ticket_reopened':
      case 'status_changed': return statusNames.get(String(value)) ?? String(value)
      case 'priority_changed': return String(value)
      case 'assignee_changed': return personNames.get(String(value)) ?? 'unknown User'
      case 'type_changed': {
        const v = value as { type: string, ref: string }
        return `${v.type} (${v.ref})`
      }
      default: return Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
    }
  }

  const items: ActivityItem[] = entries.map((e) => {
    const action = REVERSIBLE[e.action]
    const revertible = !!action && e.before !== null && e.after !== null
      && latest.get(keyOf(e)) === e.id
      && JSON.stringify(currentValue(row, e.action, e.fieldKey)) === e.after
      && !authorize(principal, action, policyFacts(row))
    return {
      type: 'event',
      id: String(e.id),
      at: e.createdAt.toISOString(),
      action: e.action as Exclude<AuditAction, 'comment_added'>,
      principal: { id: e.principalId, name: e.principalName, email: e.principalEmail },
      channel: e.channel,
      field: e.fieldKey === null ? null : { key: e.fieldKey, label: defByKey.get(e.fieldKey)?.label ?? e.fieldKey },
      before: show(e, e.before),
      after: show(e, e.after),
      unmoved: unmovedOf(e),
      erased: (!!action || e.action === 'type_changed') && e.before === null,
      reverts_id: e.revertsId,
      reverted: revertedIds.has(e.id),
      revertible,
    }
  })
  for (const c of comments) items.push({ type: 'comment', id: c.id, at: c.createdAt.toISOString(), comment: toComment(c) })
  // Array.sort is stable, so entries of the same millisecond keep the order of the log.
  return items.sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * Reverts one entry with a new change. It goes through the same policy action as the original change, and adds a
 * new audit entry that points to the old one. It refuses an entry that is not reversible (a comment, a creation,
 * erased values), or whose value is no longer current: a later change, even one that reverted this entry, wins.
 */
export async function revertEntry(db: Db, principal: Principal, number: number, entryId: number): Promise<void> {
  const row = await loadFor(db, principal, 'read', number)
  const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.id, entryId), eq(auditLog.ticketNumber, number))).limit(1)
  if (!entry) throw new PolicyRefusal({ ...NOT_FOUND, message: 'No Activity entry with this ID.' })
  const action = REVERSIBLE[entry.action]
  if (!action) throw new RevertRefusal('NOT_REVERSIBLE', 'Only a change of Status, Priority, assignee, or a Field value can be reverted.')
  assertAllowed(principal, action, policyFacts(row))
  if (entry.before === null || entry.after === null) throw new RevertRefusal('NOT_REVERSIBLE', 'The values of this entry were removed, so it cannot be reverted.')

  const [last] = await db.select({ id: auditLog.id }).from(auditLog)
    .where(and(eq(auditLog.ticketNumber, number), eq(auditLog.action, entry.action), entry.fieldKey === null ? undefined : eq(auditLog.fieldKey, entry.fieldKey)))
    .orderBy(desc(auditLog.id)).limit(1)
  if (last?.id !== entry.id || JSON.stringify(currentValue(row, entry.action, entry.fieldKey)) !== entry.after) {
    throw new RevertRefusal('VALUE_CHANGED', 'This value was changed after this entry. Revert the newer change, or set the value again.')
  }

  const target: unknown = JSON.parse(entry.before)
  const set: Partial<typeof ticket.$inferInsert> = {}
  switch (entry.action) {
    case 'status_changed': set.status = target as string; break
    case 'priority_changed': set.priority = target as typeof row.priority; break
    case 'assignee_changed': {
      if (target !== null) {
        const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, target as string)).limit(1)
        if (!u || !canBeAssignee(u.role)) throw new RevertRefusal('NOT_REVERSIBLE', 'The earlier assignee can no longer be assigned.')
      }
      set.assigneeId = target as string | null
      break
    }
    default: {
      const next = { ...row.fields }
      if (target === null) delete next[entry.fieldKey!]
      else next[entry.fieldKey!] = target
      set.fields = next
    }
  }
  const change: ChangeEntry = { action: entry.action as ChangeEntry['action'], fieldKey: entry.fieldKey ?? undefined, before: JSON.parse(entry.after), after: target, revertsId: entry.id }
  await applyChange(db, principal, number, set, [change])
}
