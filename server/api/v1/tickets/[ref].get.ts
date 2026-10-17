import { restPrincipal, routeTicketNumber, ticketError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { getTicket } from '../../../utils/tickets'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await getTicket(db, principal, routeTicketNumber(event))
  } catch (error) {
    return ticketError(error)
  }
})
