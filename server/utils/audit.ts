import { sql, type SQL } from 'drizzle-orm'
import { auditLog, type AuditAction, type AuditSubjectType } from '../db/schema'
import type { Db } from './auth'
import type { Principal } from './tickets'

export interface AuditInput {
  /** A number, or `sql\`last_insert_rowid()\`` for the ticket that an earlier statement of the same batch inserted. */
  ticketNumber: number | SQL
  action: AuditAction
  /** For `field_changed`. */
  fieldKey?: string
  /** For `comment_added`. The comment row holds the body. */
  commentId?: string
  /** The entry that this one reverts. */
  revertsId?: number
  /** The values, as the JSON of the real value. Leave out for an action that has no values. */
  values?: { before: unknown, after: unknown }
}

/**
 * The one way to write the audit log (append-only, 9.4). Returns the insert and does not run it: put it in the
 * `db.batch([...])` of the change, so the change and its entry are written together or not at all.
 * Facts go in their own columns. Values go in `before` and `after`, the only columns that Erasure clears.
 */
export function auditEntry(db: Db, principal: Principal, e: AuditInput) {
  return db.insert(auditLog).values({
    ticketNumber: e.ticketNumber,
    principalId: principal.userId,
    channel: principal.channel,
    action: e.action,
    fieldKey: e.fieldKey ?? null,
    commentId: e.commentId ?? null,
    revertsId: e.revertsId ?? null,
    // `undefined` is not JSON, so no value is written as the text `null`. SQL NULL is only for erased values.
    before: e.values ? JSON.stringify(e.values.before ?? null) : null,
    after: e.values ? JSON.stringify(e.values.after ?? null) : null,
    createdAt: new Date(),
  })
}

export interface AdminAuditInput {
  subject: {
    type: AuditSubjectType
    /** A value, or SQL for an id that an earlier statement of the same batch made (as a text id). */
    id: string | number | SQL
  }
  action: AuditAction
  /** Values only here, so Erasure can clear them. */
  values?: { before?: unknown, after?: unknown }
  /**
   * A SQL condition. When it is false the insert fails (NOT NULL), so the whole batch is rolled back.
   * Use it where the change itself is guarded, so no entry stays for a change that did not happen.
   */
  onlyIf?: SQL
}

/** `auditEntry` for an Admin change that has no ticket. Same rules: put it in the `db.batch` of the change. */
export function adminAuditEntry(db: Db, principal: Principal, e: AdminAuditInput) {
  return db.insert(auditLog).values({
    ticketNumber: null,
    subjectType: e.subject.type,
    subjectId: typeof e.subject.id === 'object' ? e.subject.id : String(e.subject.id),
    principalId: e.onlyIf ? sql`(select ${principal.userId} where ${e.onlyIf})` : principal.userId,
    channel: principal.channel,
    action: e.action,
    before: e.values && 'before' in e.values ? JSON.stringify(e.values.before ?? null) : null,
    after: e.values && 'after' in e.values ? JSON.stringify(e.values.after ?? null) : null,
    createdAt: new Date(),
  })
}
