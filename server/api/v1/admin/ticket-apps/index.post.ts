import { adminPrincipal, readJson, ticketAppError, validationFailed } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { createTicketApp, ticketAppCreateInput } from '../../../../utils/ticket-apps'

/** `{ name, url, position, ticket_type_ids?, enabled? }`. `ticket_type_ids: null` is all Ticket Types. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = ticketAppCreateInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    setResponseStatus(event, 201)
    return await createTicketApp(db, principal, parsed.data)
  } catch (error) {
    return ticketAppError(error)
  }
})
