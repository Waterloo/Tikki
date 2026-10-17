import { restPrincipal, routeTicketNumber, ticketError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { updateTicket } from '../../../utils/tickets'

/** Changes Status, Priority, or assignee: `{ status?, priority?, assignee_id? }`. `assignee_id: null` unassigns. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await updateTicket(db, principal, routeTicketNumber(event), await readBody(event))
  } catch (error) {
    return ticketError(error)
  }
})
