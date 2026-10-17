import { adminPrincipal, apiError, routeId, typeAdminError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { updateTicketType } from '../../../utils/ticket-type-admin'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event)
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket Type has this ID.')
  try {
    return await updateTicketType(db, id, await readBody(event))
  } catch (error) {
    return typeAdminError(error)
  }
})
