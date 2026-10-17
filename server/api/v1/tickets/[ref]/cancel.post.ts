import { restPrincipal, routeTicketNumber, ticketError } from '../../../../utils/rest'
import { cancelTicket } from '../../../../utils/self-service'
import { db } from '../../../../utils/services'

/** The Requester cancels their ticket. It closes with the reason "cancelled by requester". */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await cancelTicket(db, principal, routeTicketNumber(event))
  } catch (error) {
    return ticketError(error)
  }
})
