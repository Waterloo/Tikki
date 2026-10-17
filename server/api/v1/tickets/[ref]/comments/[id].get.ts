import { getComment } from '../../../../../utils/activity'
import { apiError, restPrincipal, routeTicketNumber, ticketError } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const found = await getComment(db, principal, routeTicketNumber(event), getRouterParam(event, 'id') ?? '')
    // An Internal Comment that the caller may not see answers exactly like a comment that does not exist.
    return found ?? apiError(404, 'NOT_FOUND', 'No comment with this ID.')
  } catch (error) {
    return ticketError(error)
  }
})
