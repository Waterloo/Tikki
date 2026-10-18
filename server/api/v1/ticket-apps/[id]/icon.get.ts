import { env } from '../../../../utils/env'
import { authorizeTicketAppIcon } from '../../../../utils/policy'
import { apiError, routeId, sessionPrincipal } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { iconModeParam, readTicketAppIcon } from '../../../../utils/ticket-app-icons'

/** The icon image of a Ticket App, for a signed-in User who may see the app. `?mode=light|dark`; `?v=` is for the cache only. */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  const refusal = authorizeTicketAppIcon(principal)
  const id = routeId(event, 'id')
  if (refusal || id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  const mode = iconModeParam(event, 'light')
  if (mode instanceof Response) return mode
  return await readTicketAppIcon(db, env.FILES, id, mode) ?? apiError(404, 'NOT_FOUND', 'This Ticket App has no icon image.')
})
