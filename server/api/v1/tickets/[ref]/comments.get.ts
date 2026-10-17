import { listComments } from '../../../../utils/activity'
import { restPrincipal, routeTicketNumber, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'

/** The comments the caller may see. A Requester gets no Internal Comments. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return { data: await listComments(db, principal, routeTicketNumber(event)) }
  } catch (error) {
    return ticketError(error)
  }
})
