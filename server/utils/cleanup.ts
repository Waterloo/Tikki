import { and, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { attachment, uploadLink } from '../db/schema'
import type { Db } from './auth'

const DAY_MS = 24 * 60 * 60 * 1000
// Bound for each table in one run, like the outbox run. A bigger backlog finishes over the next runs.
const BATCH = 100

/**
 * Deletes unattached uploads older than 24 hours (R2 object and row), and Upload Links that were used or expired
 * more than 24 hours ago (7.9).
 *
 * D1 and R2 cannot share a transaction, so the order is: (1) mark the rows erased, which no route serves or claims;
 * (2) delete the R2 objects; (3) delete the rows. A failure in step 2 leaves marked rows, never a claimable row
 * without an object, and the next run takes the marked rows first and finishes the job.
 */
export async function cleanupUploads(db: Db, bucket: R2Bucket, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DAY_MS)
  const unattached = isNull(attachment.ticketNumber)
  await db.update(attachment).set({ erasedAt: now }).where(and(
    unattached, isNull(attachment.erasedAt), lt(attachment.createdAt, cutoff),
    inArray(attachment.id, db.select({ id: attachment.id }).from(attachment).where(and(unattached, isNull(attachment.erasedAt), lt(attachment.createdAt, cutoff))).limit(BATCH)),
  ))
  const files = await db.select({ id: attachment.id }).from(attachment).where(and(unattached, isNotNull(attachment.erasedAt))).limit(BATCH)
  if (files.length) {
    const ids = files.map(f => f.id)
    await bucket.delete(ids)
    await db.delete(attachment).where(and(unattached, inArray(attachment.id, ids)))
  }

  await db.delete(uploadLink).where(inArray(uploadLink.tokenHash,
    db.select({ hash: uploadLink.tokenHash }).from(uploadLink).where(or(lt(uploadLink.usedAt, cutoff), lt(uploadLink.expiresAt, cutoff))).limit(BATCH)))
}
