import { apiError, restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { getTicket, parseTicketReference } from '../../../utils/tickets'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const number = parseTicketReference(getRouterParam(event, 'ref') ?? '')
  const found = number === null ? null : await getTicket(db, principal, number)
  // Not found and not visible get the same answer, so a Requester cannot probe other people's tickets.
  return found ?? apiError(404, 'NOT_FOUND', 'No ticket with this reference.')
})
