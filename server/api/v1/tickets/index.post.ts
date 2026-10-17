import { restPrincipal, validationError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { createTicket, TicketValidationError } from '../../../utils/tickets'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const created = await createTicket(db, principal, await readBody(event))
    setResponseStatus(event, 201)
    return created
  } catch (error) {
    if (error instanceof TicketValidationError) return validationError(error)
    throw error
  }
})
