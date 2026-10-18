import { adminPrincipal, apiError, readJson, routeId, ticketAppError, validationFailed } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { moveTicketApp, ticketAppMoveInput } from '../../../../../utils/ticket-apps'

/** `{ direction: 'up' | 'down' }`. Answers with the whole list in the new order. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = ticketAppMoveInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    return { data: await moveTicketApp(db, principal, id, parsed.data.direction) }
  } catch (error) {
    return ticketAppError(error)
  }
})
