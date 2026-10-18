import { authorizeTicketApps } from '../../../../../../utils/policy'
import { apiError, routeId, routeTicketNumber, sessionPrincipal, ticketAppError } from '../../../../../../utils/rest'
import { db } from '../../../../../../utils/services'
import { contextToken } from '../../../../../../utils/ticket-apps'
import { getTicket } from '../../../../../../utils/tickets'

/** A context token and the context for one app on one ticket (ADR 0004). Records nothing. */
export default defineEventHandler(async (event) => {
  // Session only. A Bearer header is refused, so no key or token can mint a token.
  if (event.headers.has('authorization')) return apiError(403, 'FORBIDDEN', 'A context token needs a web session. An API key cannot get one.')
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  const refusal = authorizeTicketApps(principal)
  if (refusal) return apiError(refusal.status, refusal.code, refusal.message)
  const appId = routeId(event, 'appId')
  try {
    const ticket = await getTicket(db, principal, routeTicketNumber(event))
    if (appId === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
    return await contextToken(db, principal, appId, ticket)
  } catch (error) {
    return ticketAppError(error)
  }
})
