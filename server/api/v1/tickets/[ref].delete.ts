import { deleteTicket } from '../../../utils/privacy'
import { restPrincipal, routeTicketNumber, ticketError } from '../../../utils/rest'
import { db } from '../../../utils/services'

/** Soft delete (Admins). The ticket is hidden from every channel until an Admin restores it. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    await deleteTicket(db, principal, routeTicketNumber(event))
    setResponseStatus(event, 204)
    return null
  } catch (error) {
    return ticketError(error)
  }
})
