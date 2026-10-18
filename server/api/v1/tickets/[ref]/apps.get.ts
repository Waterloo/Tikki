import { authorizeTicketApps } from '../../../../utils/policy'
import { apiError, routeTicketNumber, sessionPrincipal, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { appsForType } from '../../../../utils/ticket-apps'
import { loadFor } from '../../../../utils/tickets'

/** The Ticket Apps shown on this ticket. Staff only, session only. */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  const refusal = authorizeTicketApps(principal)
  if (refusal) return apiError(refusal.status, refusal.code, refusal.message)
  try {
    const row = await loadFor(db, principal, 'read', routeTicketNumber(event))
    return { data: await appsForType(db, row.typeId) }
  } catch (error) {
    return ticketError(error)
  }
})
