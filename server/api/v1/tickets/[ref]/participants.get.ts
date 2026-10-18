import { listParticipants } from '../../../../utils/participants'
import { routeTicketNumber, sessionPrincipal, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'

/** The Requester, the assignee, and the added Users. For signed-in Users: an Application has no Restricted tickets. */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return { data: await listParticipants(db, principal, routeTicketNumber(event)) }
  } catch (error) {
    return ticketError(error)
  }
})
