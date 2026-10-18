import { env } from '../../../../../utils/env'
import { adminPrincipal, apiError, routeId, ticketAppError } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { iconModeParam, setTicketAppIcon } from '../../../../../utils/ticket-app-icons'

/** The body is the image (PNG, WebP or SVG, at most 256 KB). `?mode=light|dark`. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  const mode = iconModeParam(event)
  if (mode instanceof Response) return mode
  try {
    return await setTicketAppIcon(db, env.FILES, principal, id, mode, toWebRequest(event))
  } catch (error) {
    return ticketAppError(error)
  }
})
