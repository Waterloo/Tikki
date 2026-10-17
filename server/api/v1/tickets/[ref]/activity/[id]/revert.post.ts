import { revertEntry } from '../../../../../../utils/activity'
import { apiError, restPrincipal, routeTicketNumber, ticketError } from '../../../../../../utils/rest'
import { db } from '../../../../../../utils/services'
import { getTicket } from '../../../../../../utils/tickets'

/** Reverts one Activity entry with a new change. Answers with the ticket. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const number = routeTicketNumber(event)
    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isSafeInteger(id) || id < 1) return apiError(404, 'NOT_FOUND', 'No Activity entry with this ID.')
    await revertEntry(db, principal, number, id)
    return await getTicket(db, principal, number)
  } catch (error) {
    return ticketError(error)
  }
})
