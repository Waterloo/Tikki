import { adminPrincipal, apiError, routeId, ticketAppError } from '../../../../../../utils/rest'
import { db } from '../../../../../../utils/services'
import { checkManifestUpdate } from '../../../../../../utils/ticket-app-manifest'

/** "Check for updates": the new manifest and what changed. Changes nothing. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  try {
    return await checkManifestUpdate(db, id)
  } catch (error) {
    return ticketAppError(error)
  }
})
