import { sha256Hex } from '../../../utils/applications'
import { apiError, readJson, restPrincipal, ticketError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { createApplicationTicket, createTicket } from '../../../utils/tickets'

const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/

/**
 * Creates a ticket. A User is the Requester of their own ticket. An Application sends `contact`, and that Contact is
 * the Requester. An Application may send `Idempotency-Key` (6.3); a repeat answers with the first ticket.
 */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const body = await readJson(event)
  if (body instanceof Response) return body
  try {
    if (principal.kind === 'user') {
      setResponseStatus(event, 201)
      return await createTicket(db, principal, body.value)
    }
    const key = getHeader(event, 'idempotency-key')
    if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
      return apiError(400, 'INVALID_IDEMPOTENCY_KEY', 'The Idempotency-Key must be 1 to 255 visible ASCII characters, for example a UUID.')
    }
    const idempotency = key === undefined ? undefined : { key, requestHash: await sha256Hex(body.raw) }
    const { ticket, replayed } = await createApplicationTicket(db, principal, body.value, idempotency)
    if (replayed) setResponseHeader(event, 'idempotent-replayed', 'true')
    setResponseStatus(event, 201)
    return ticket
  } catch (error) {
    return ticketError(error)
  }
})
