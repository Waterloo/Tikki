import { lt, sql } from 'drizzle-orm'
import { rateCounter } from '../db/schema'
import type { Db } from './auth'
import { config } from './env'

export const WINDOW_MS = 60_000
export const DEFAULT_REQUEST_LIMIT = 60
export const DEFAULT_CREATE_LIMIT = 10
export const USER_WEB_LIMIT = 120
export const USER_MCP_LIMIT = 30
export const USER_MCP_WRITE_LIMIT = 10
export const SIGN_IN_LIMIT = 10

export interface Limited {
  retryAfter: number
}

/**
 * Counts one event in the current minute for `key`. Returns null while the count is within `limit`, else the seconds to wait.
 * One UPSERT, so concurrent requests cannot lose a count. A refused event still counts: a client that keeps pushing stays refused.
 * Fixed windows: a burst across a minute boundary can reach twice the limit. That is fine for abuse control at this scale.
 */
export async function takeSlot(db: Db, key: string, limit: number, now = Date.now()): Promise<Limited | null> {
  if (config.rateLimitsOff) return null
  const window = now - (now % WINDOW_MS)
  const [row] = await db.insert(rateCounter).values({ key, window, count: 1 })
    .onConflictDoUpdate({ target: [rateCounter.key, rateCounter.window], set: { count: sql`${rateCounter.count} + 1` } })
    .returning({ count: rateCounter.count })
  if (row!.count <= limit) return null
  return { retryAfter: Math.max(1, Math.ceil((window + WINDOW_MS - now) / 1000)) }
}

/** Deletes counters of finished minutes. Called by the cron. */
export async function deleteOldCounters(db: Db, now = Date.now()) {
  await db.delete(rateCounter).where(lt(rateCounter.window, now - 2 * WINDOW_MS))
}

/** One AI tool call: through `/mcp`, or a page request with `X-Tikki-Channel: ai`. A write takes both slots. */
export async function takeToolSlot(db: Db, userId: string, write: boolean): Promise<Limited | null> {
  return (write ? await takeSlot(db, `mcp-write:${userId}`, USER_MCP_WRITE_LIMIT) : null)
    ?? await takeSlot(db, `mcp:${userId}`, USER_MCP_LIMIT)
}

export function limitMessage(what: string, { retryAfter }: Limited) {
  return `Too many ${what}. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`
}
