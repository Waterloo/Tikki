import type { H3Event } from 'h3'
import { AttachmentError, storeUpload } from './attachments'
import { env } from './env'
import { NOT_FOUND, PolicyRefusal } from './policy'
import { apiError, restPrincipal } from './rest'
import { db } from './services'
import { parseTicketReference } from './tickets'

const TICKET_UPLOAD = /^\/api\/v1\/tickets\/([^/]+)\/attachments$/
const UNATTACHED_UPLOAD = '/api/v1/attachments'

/**
 * The upload routes, handled before Nitro. Nitro's Cloudflare entry copies every request body into memory
 * before a route runs, which a 25 MB upload cannot afford. Returns null for any other request.
 */
export async function handleUpload(request: Request): Promise<Response | null> {
  if (request.method !== 'PUT') return null
  const path = new URL(request.url).pathname
  const target = TICKET_UPLOAD.exec(path)
  if (!target && path !== UNATTACHED_UPLOAD) return null

  // restPrincipal reads only the headers.
  const principal = await restPrincipal({ headers: request.headers } as H3Event)
  if (principal instanceof Response) return principal
  try {
    let ticketNumber: number | null = null
    if (target) {
      ticketNumber = parseTicketReference(decodeURIComponent(target[1]!))
      if (ticketNumber === null) throw new PolicyRefusal(NOT_FOUND)
    }
    const created = await storeUpload(db, env.FILES, principal, ticketNumber, request)
    return Response.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof PolicyRefusal) return apiError(error.refusal.status, error.refusal.code, error.refusal.message)
    if (error instanceof AttachmentError) return apiError(error.status, error.code, error.message)
    throw error
  }
}
