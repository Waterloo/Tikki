import { createComment } from '../../../../utils/activity'
import { restPrincipal, routeTicketNumber, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'

/** `{ body, visibility? }`. Without a visibility, an Agent writes an Internal Comment. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const created = await createComment(db, principal, routeTicketNumber(event), await readBody(event))
    setResponseStatus(event, 201)
    return created
  } catch (error) {
    return ticketError(error)
  }
})
