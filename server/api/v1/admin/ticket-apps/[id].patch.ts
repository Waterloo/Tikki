import { adminPrincipal, apiError, readJson, routeId, ticketAppError, validationFailed } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { ticketAppUpdateInput, updateTicketApp } from '../../../../utils/ticket-apps'

/** Any of `name`, `url`, `position`, `ticket_type_ids`, `enabled`. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = ticketAppUpdateInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    return await updateTicketApp(db, principal, id, parsed.data)
  } catch (error) {
    return ticketAppError(error)
  }
})
