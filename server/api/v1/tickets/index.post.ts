import { restPrincipal, ticketError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { createTicket } from '../../../utils/tickets'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const created = await createTicket(db, principal, await readBody(event))
    setResponseStatus(event, 201)
    return created
  } catch (error) {
    return ticketError(error)
  }
})
