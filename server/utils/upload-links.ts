import { and, eq, gt, isNull } from 'drizzle-orm'
import { uploadLink } from '../db/schema'
import type { Db } from './auth'
import { assertCanAttach, AttachmentError, parseUploadHeaders, putObject, type AttachmentView } from './attachments'
import { config } from './env'
import type { UserPrincipal } from './tickets'
import { getTicket } from './tickets'

/** An Upload Link lives 15 minutes (5.9). */
export const LINK_TTL_MS = 15 * 60 * 1000

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** Makes a link for one ticket and the Principal. The token is shown once; only its hash is stored. */
export async function createUploadLink(db: Db, principal: UserPrincipal, ticketNumber: number, now = Date.now()) {
  await assertCanAttach(db, principal, ticketNumber)
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const expiresAt = new Date(now + LINK_TTL_MS)
  await db.insert(uploadLink).values({ tokenHash: await hashToken(token), ticketNumber, userId: principal.userId, expiresAt, createdAt: new Date(now) })
  return { url: `${config.appUrl}/upload/${token}`, expiresAt: expiresAt.toISOString() }
}

const gone = (code: string, message: string) => new AttachmentError(410, code, message)

/** The link, if this Principal may use it now. Unknown tokens and other people's links are refused with a reason. */
async function usableLink(db: Db, principal: UserPrincipal, token: string, now: number) {
  const [row] = await db.select().from(uploadLink).where(eq(uploadLink.tokenHash, await hashToken(token))).limit(1)
  if (!row) throw new AttachmentError(404, 'LINK_NOT_FOUND', 'This upload link is not valid.')
  if (row.userId !== principal.userId) throw new AttachmentError(403, 'LINK_WRONG_USER', 'This upload link was made for another account. Sign in as the person who asked for it.')
  if (row.usedAt) throw gone('LINK_USED', 'This upload link was already used. Ask Claude for a new one.')
  if (row.expiresAt.getTime() <= now) throw gone('LINK_EXPIRED', 'This upload link has expired. Ask Claude for a new one.')
  return row
}

/** What the upload page shows. It does not use the link. */
export async function describeUploadLink(db: Db, principal: UserPrincipal, token: string, now = Date.now()) {
  const row = await usableLink(db, principal, token, now)
  // Policy may have changed since the link was made.
  const t = await getTicket(db, principal, row.ticketNumber)
  return { ticket_ref: t.ref, ticket_title: t.title, expires_at: row.expiresAt.toISOString() }
}

/**
 * Uploads the body of `request` to the ticket of the link. The link is claimed before the body is read, with one
 * conditional UPDATE: of two parallel uploads only one changes a row. A failed upload gives the claim back,
 * so the person can try again until it works once.
 */
export async function uploadViaLink(db: Db, bucket: R2Bucket, principal: UserPrincipal, token: string, request: Request, now = Date.now()): Promise<AttachmentView> {
  const link = await usableLink(db, principal, token, now)
  await assertCanAttach(db, principal, link.ticketNumber)
  const info = parseUploadHeaders(request.headers)
  if (!request.body) throw new AttachmentError(422, 'EMPTY_FILE', 'The file is empty.')

  const claimedAt = new Date(now)
  const claim = await db.update(uploadLink).set({ usedAt: claimedAt })
    .where(and(eq(uploadLink.tokenHash, link.tokenHash), eq(uploadLink.userId, principal.userId), isNull(uploadLink.usedAt), gt(uploadLink.expiresAt, claimedAt))).run()
  if (claim.meta.changes !== 1) throw gone('LINK_USED', 'This upload link was already used. Ask Claude for a new one.')
  try {
    return await putObject(db, bucket, principal, link.ticketNumber, info, request.body)
  } catch (error) {
    await db.update(uploadLink).set({ usedAt: null }).where(and(eq(uploadLink.tokenHash, link.tokenHash), eq(uploadLink.usedAt, claimedAt)))
    throw error
  }
}
