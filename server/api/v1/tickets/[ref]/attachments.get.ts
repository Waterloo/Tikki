import { listAttachments } from '../../../../utils/attachments'
import { restPrincipal, routeTicketNumber, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return { data: await listAttachments(db, principal, routeTicketNumber(event)) }
  } catch (error) {
    return ticketError(error)
  }
})
