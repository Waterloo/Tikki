import { apiError, routeId, sessionPrincipal, ticketAppError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { pageToken } from '../../../../utils/ticket-apps'

/** A page token and the page context for one app page (issue 39, ADR 0005). Records nothing. */
export default defineEventHandler(async (event) => {
  // Session only. A Bearer header is refused, so no key or token can mint a token.
  if (event.headers.has('authorization')) return apiError(403, 'FORBIDDEN', 'A page token needs a web session. An API key cannot get one.')
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  try {
    return await pageToken(db, principal, id)
  } catch (error) {
    return ticketAppError(error)
  }
})
