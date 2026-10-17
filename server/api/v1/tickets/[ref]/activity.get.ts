import { listActivity } from '../../../../utils/activity'
import { restPrincipal, routeTicketNumber, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'

/** The audit log of the ticket mixed with its comments, oldest first. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return { data: await listActivity(db, principal, routeTicketNumber(event)) }
  } catch (error) {
    return ticketError(error)
  }
})
