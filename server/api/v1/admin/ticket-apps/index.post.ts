import { adminPrincipal, readJson, ticketAppError, validationFailed } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { createTicketApp, ticketAppCreateInput } from '../../../../utils/ticket-apps'

/** `{ name, sidebar_url?, tab_url?, page_url?, ticket_type_ids?, access?, enabled? }`. At least one URL. `ticket_type_ids: null` is all Ticket Types. */
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
