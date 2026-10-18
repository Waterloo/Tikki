import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { attachment, contact, status, ticket, ticketParticipant, ticketType, type StatusCategory, type TicketVisibility } from '../db/schema'
import { auditEntry } from './audit'
import type { Db } from './auth'
import type { FieldError } from './fields'
import { authorizeAttach, authorizeAttachmentRead, authorizeUnattachedUpload, NO_ATTACHMENT, NOT_FOUND, PolicyRefusal, type PolicyTicket } from './policy'
import type { Principal, UserPrincipal } from './tickets'

/** 25 MB (7.4). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export class AttachmentError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 410 | 411 | 413 | 422, readonly code: string, message: string) {
    super(message)
    this.name = 'AttachmentError'
  }
}

export interface AttachmentView {
  id: string
  ticket_number: number | null
  filename: string
  content_type: string
  size: number
  /** The User who uploaded it, or null when an Application did (`application_id`). */
  uploader_id: string | null
  application_id: number | null
  created_at: string
  url: string
}

type Row = typeof attachment.$inferSelect

function toView(row: Row): AttachmentView {
  return {
    id: row.id,
    ticket_number: row.ticketNumber,
    filename: row.filename,
    content_type: row.contentType,
    size: row.size,
    uploader_id: row.uploaderId,
    application_id: row.applicationId,
    created_at: row.createdAt.toISOString(),
    url: `/api/v1/attachments/${row.id}`,
  }
}

interface UploadInfo {
  size: number
  filename: string
  contentType: string
}

/** Path separators and control characters never belong in a name that people download. */
export function cleanFilename(name: string): string {
  return name.replace(/[\u0000-\u001F\u007F/\\]/g, '_').trim().slice(0, 200)
}

/** Checks the headers only, so a refused upload costs no body read. */
export function parseUploadHeaders(headers: Headers): UploadInfo {
  const length = headers.get('content-length')
  if (length === null) throw new AttachmentError(411, 'LENGTH_REQUIRED', 'Send a Content-Length header. Uploads are not accepted without it.')
  if (!/^\d{1,15}$/.test(length)) throw new AttachmentError(400, 'INVALID_LENGTH', 'Content-Length must be a number of bytes.')
  const size = Number(length)
  if (size === 0) throw new AttachmentError(422, 'EMPTY_FILE', 'The file is empty.')
  if (size > MAX_ATTACHMENT_BYTES) throw new AttachmentError(413, 'FILE_TOO_LARGE', 'The file must be 25 MB or smaller.')

  // Percent-encoded UTF-8, because header values cannot carry other characters.
  const raw = headers.get('x-filename')
  let decoded = ''
  try {
    decoded = raw === null ? '' : decodeURIComponent(raw)
  } catch {
    throw new AttachmentError(422, 'INVALID_FILENAME', 'X-Filename must be percent-encoded UTF-8.')
  }
  const filename = cleanFilename(decoded)
  if (!filename) throw new AttachmentError(422, 'FILENAME_REQUIRED', 'Send the file name in the X-Filename header (percent-encoded).')

  const type = headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  return { size, filename, contentType: /^[a-z0-9!#$&^_.+-]{1,60}\/[a-z0-9!#$&^_.+-]{1,60}$/.test(type) ? type : 'application/octet-stream' }
}

interface FactsRow { requesterId: string | null, applicationId: number | null, assigneeId: string | null, visibility: TicketVisibility | null, participantIds: string, statusKey: string | null, statusCategory: StatusCategory | null, deletedAt: Date | null }

function policyTicket(row: FactsRow): PolicyTicket {
  if (row.statusKey === null || row.statusCategory === null || row.visibility === null) throw new Error('A ticket has no Status or type. Every ticket must have both.')
  return {
    requesterId: row.requesterId,
    applicationId: row.applicationId,
    assigneeId: row.assigneeId,
    visibility: row.visibility,
    participantIds: JSON.parse(row.participantIds) as string[],
    statusKey: row.statusKey,
    statusCategory: row.statusCategory,
    deleted: row.deletedAt !== null,
  }
}

const factsColumns = {
  requesterId: ticket.requesterId,
  applicationId: contact.applicationId,
  assigneeId: ticket.assigneeId,
  visibility: ticketType.visibility,
  participantIds: sql<string>`(SELECT json_group_array(${ticketParticipant.userId}) FROM ${ticketParticipant} WHERE ${ticketParticipant.ticketNumber} = ${ticket.number})`,
  statusKey: status.key,
  statusCategory: status.category,
  deletedAt: ticket.deletedAt,
}

async function loadPolicyTicket(db: Db, number: number): Promise<PolicyTicket | null> {
  const [row] = await db.select(factsColumns).from(ticket)
    .innerJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
    .leftJoin(status, eq(ticket.status, status.key))
    .leftJoin(contact, eq(ticket.contactId, contact.id))
    .where(eq(ticket.number, number)).limit(1)
  return row ? policyTicket(row) : null
}

/** Throws the refusal when the Principal may not add a file to the ticket. */
export async function assertCanAttach(db: Db, principal: Principal, ticketNumber: number): Promise<void> {
  const facts = await loadPolicyTicket(db, ticketNumber)
  const refusal = facts ? authorizeAttach(principal, facts) : NOT_FOUND
  if (refusal) throw new PolicyRefusal(refusal)
}

/**
 * Streams the body straight into R2 and records it. `ticketNumber` null is an upload made before its ticket exists.
 * The caller passes the raw request: its body must not have been read.
 */
export async function storeUpload(db: Db, bucket: R2Bucket, principal: Principal, ticketNumber: number | null, request: Request): Promise<AttachmentView> {
  if (ticketNumber !== null) await assertCanAttach(db, principal, ticketNumber)
  else {
    const refusal = authorizeUnattachedUpload(principal)
    if (refusal) throw new PolicyRefusal(refusal)
  }
  const info = parseUploadHeaders(request.headers)
  if (!request.body) throw new AttachmentError(422, 'EMPTY_FILE', 'The file is empty.')
  return putObject(db, bucket, principal, ticketNumber, info, request.body)
}

/** The one place that writes a file: R2 first, then the record (with its audit entry, for a ticket). The caller has checked the policy. */
export async function putObject(db: Db, bucket: R2Bucket, principal: Principal, ticketNumber: number | null, info: UploadInfo, body: ReadableStream | string): Promise<AttachmentView> {
  const id = crypto.randomUUID()
  let stored: R2Object
  try {
    stored = await bucket.put(id, body, { httpMetadata: { contentType: info.contentType } })
  } catch {
    // The runtime ends the body when fewer bytes than declared arrive.
    throw new AttachmentError(400, 'UPLOAD_INCOMPLETE', 'The body did not match Content-Length. Upload the file again.')
  }
  // R2 knows the length from the header; this stops a stored size that differs from the declared one.
  if (stored.size !== info.size) {
    await bucket.delete(id)
    throw new AttachmentError(400, 'UPLOAD_INCOMPLETE', 'The body did not match Content-Length. Upload the file again.')
  }
  try {
    const insert = db.insert(attachment).values({
      id,
      ticketNumber,
      ...(principal.kind === 'user' ? { uploaderId: principal.userId } : { applicationId: principal.applicationId }),
      filename: info.filename, contentType: info.contentType, size: info.size,
    }).returning()
    const [row] = ticketNumber === null
      ? await insert
      : (await db.batch([insert, auditEntry(db, principal, { ticketNumber, action: 'attachment_added', values: { before: null, after: info.filename } })]))[0]
    return toView(row!)
  } catch (error) {
    await bucket.delete(id)
    throw error
  }
}

/** 256 KB (UTF-8 bytes) for text that Claude sends in a tool call. */
export const MAX_TEXT_BYTES = 256 * 1024

/**
 * Attaches text from Claude. Same policy and same code as a REST upload; the size is counted in UTF-8 bytes.
 * The type is never taken from the caller: `text/csv` for a `.csv` name, else `text/plain`. Both are safe types.
 */
export async function attachText(db: Db, bucket: R2Bucket, principal: Principal, ticketNumber: number, filename: unknown, content: unknown): Promise<AttachmentView> {
  await assertCanAttach(db, principal, ticketNumber)
  const name = typeof filename === 'string' ? cleanFilename(filename) : ''
  if (!name) throw new AttachmentError(422, 'FILENAME_REQUIRED', 'Send a file name, for example "error.log".')
  if (typeof content !== 'string' || content.length === 0) throw new AttachmentError(422, 'EMPTY_FILE', 'The text is empty.')
  const size = new TextEncoder().encode(content).byteLength
  if (size > MAX_TEXT_BYTES) {
    throw new AttachmentError(413, 'FILE_TOO_LARGE', `The text is ${size} bytes. The limit is ${MAX_TEXT_BYTES} bytes (256 KB). Send a shorter excerpt, or ask the user to upload the file with request_upload_link.`)
  }
  const contentType = name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'text/plain'
  return putObject(db, bucket, principal, ticketNumber, { size, filename: name, contentType }, content)
}

/** The attachments of a ticket the Principal may read (seeing a ticket and adding to it need the same right). */
export async function listAttachments(db: Db, principal: Principal, ticketNumber: number): Promise<AttachmentView[]> {
  const facts = await loadPolicyTicket(db, ticketNumber)
  const refusal = facts ? authorizeAttach(principal, facts) : NOT_FOUND
  if (refusal) throw new PolicyRefusal(refusal)
  const rows = await db.select().from(attachment).where(and(eq(attachment.ticketNumber, ticketNumber), isNull(attachment.erasedAt))).orderBy(asc(attachment.createdAt), asc(attachment.id))
  return rows.map(toView)
}

// Served as sent only for types that cannot run script. Anything else, HTML and SVG included, is a plain download.
const SAFE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv', 'application/json', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/** RFC 6266 with the RFC 5987 form for names that are not plain ASCII. */
export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]|["\\%;]/g, '_')
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

/** The file, if the Principal may read it. Throws PolicyRefusal otherwise. */
export async function downloadAttachment(db: Db, bucket: R2Bucket, principal: Principal, id: string): Promise<Response> {
  const [row] = await db.select({ file: attachment, ...factsColumns }).from(attachment)
    .leftJoin(ticket, eq(attachment.ticketNumber, ticket.number))
    .leftJoin(ticketType, eq(ticket.ticketTypeId, ticketType.id))
    .leftJoin(status, eq(ticket.status, status.key))
    .leftJoin(contact, eq(ticket.contactId, contact.id))
    .where(eq(attachment.id, id)).limit(1)
  // An erased file may still be in R2 until Erasure finishes; its row must never lead to it.
  if (!row || row.file.erasedAt !== null) throw new PolicyRefusal(NO_ATTACHMENT)
  // Not `requesterId === null`: a Contact's ticket has no User Requester.
  const refusal = authorizeAttachmentRead(principal, {
    uploaderId: row.file.uploaderId,
    ticket: row.file.ticketNumber === null ? null : policyTicket(row),
  })
  if (refusal) throw new PolicyRefusal(refusal)

  const object = await bucket.get(id)
  if (!object) throw new Error(`Attachment ${id} has a record but no file in the bucket.`)
  return new Response(object.body, {
    headers: {
      'content-type': SAFE_TYPES.has(row.file.contentType) ? row.file.contentType : 'application/octet-stream',
      'content-length': String(object.size),
      'content-disposition': contentDisposition(row.file.filename),
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'default-src \'none\'; sandbox',
      'cache-control': 'private, no-store',
    },
  })
}

export interface FileRef {
  key: string
  label: string
  id: unknown
}

/**
 * A file Field may point only to a file of the same ticket, or to an unattached upload of the same User.
 * Unknown IDs and other people's IDs get the same reason, so nobody can probe for files.
 */
export async function checkFileRefs(db: Db, principal: Principal, ticketNumber: number | null, refs: FileRef[]): Promise<FieldError[]> {
  if (refs.length === 0) return []
  const rows = await db.select({ id: attachment.id, ticketNumber: attachment.ticketNumber, uploaderId: attachment.uploaderId })
    .from(attachment).where(inArray(attachment.id, refs.map(r => String(r.id))))
  const byId = new Map(rows.map(r => [r.id, r]))
  return refs.flatMap((ref) => {
    const row = byId.get(String(ref.id))
    const usable = row && (ticketNumber !== null && row.ticketNumber === ticketNumber
      || row.ticketNumber === null && principal.kind === 'user' && row.uploaderId === principal.userId)
    return usable ? [] : [{ key: ref.key, label: ref.label, reason: 'Must be the ID of a file you uploaded to this ticket.' }]
  })
}

/** A batch statement: the new ticket (the last insert in the batch) takes the unattached uploads of this User. */
export function claimUploads(db: Db, principal: UserPrincipal, ids: string[]) {
  return db.update(attachment).set({ ticketNumber: sql`last_insert_rowid()` })
    .where(and(inArray(attachment.id, ids), isNull(attachment.ticketNumber), eq(attachment.uploaderId, principal.userId)))
}
