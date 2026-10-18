import { adminPrincipal, apiError, routeId, ticketAppError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { deleteTicketApp } from '../../../../utils/ticket-apps'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  try {
    await deleteTicketApp(db, principal, id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return ticketAppError(error)
  }
})
