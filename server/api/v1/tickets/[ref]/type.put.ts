import { restPrincipal, routeTicketNumber, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { changeTicketType } from '../../../../utils/ticket-type-change'

/** `{ ticket_type_id }`. Agents only. The number stays and the prefix changes. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await changeTicketType(db, principal, routeTicketNumber(event), await readBody(event))
  } catch (error) {
    return ticketError(error)
  }
})
