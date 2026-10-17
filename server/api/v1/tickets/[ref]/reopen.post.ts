import { restPrincipal, routeTicketNumber, ticketError } from '../../../../utils/rest'
import { reopenTicket } from '../../../../utils/self-service'
import { db } from '../../../../utils/services'

/** Reopens a resolved ticket. 200 with the same ticket within 14 days; 201 with a new, linked ticket after that. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const { ticket, created } = await reopenTicket(db, principal, routeTicketNumber(event))
    setResponseStatus(event, created ? 201 : 200)
    return ticket
  } catch (error) {
    return ticketError(error)
  }
})
