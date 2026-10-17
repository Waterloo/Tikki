import { adminPrincipal, apiError, routeId } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { getAdminType } from '../../../../utils/ticket-type-admin'

// All Fields of the newest Schema Version, archived ones too.
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event)
  const found = id === null ? null : await getAdminType(db, id)
  return found ?? apiError(404, 'NOT_FOUND', 'No Ticket Type has this ID.')
})
