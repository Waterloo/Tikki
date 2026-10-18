import { adminPrincipal, apiError, routeId, ticketAppError } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { iconModeParam, removeTicketAppIcon } from '../../../../../utils/ticket-app-icons'

/** `?mode=light|dark`. Removing the light image also removes the dark one. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  const mode = iconModeParam(event)
  if (mode instanceof Response) return mode
  try {
    return await removeTicketAppIcon(db, principal, id, mode)
  } catch (error) {
    return ticketAppError(error)
  }
})
