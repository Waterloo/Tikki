import type { SQL } from 'drizzle-orm'
import { auditLog, type AuditAction } from '../db/schema'
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
