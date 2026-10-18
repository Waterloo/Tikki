import { restoreTicket } from '../../../../utils/privacy'
import { restPrincipal, routeTicketNumber, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'

/** Makes a soft-deleted ticket visible again (Admins). Answers with the ticket. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await restoreTicket(db, principal, routeTicketNumber(event))
  } catch (error) {
    return ticketError(error)
  }
})
