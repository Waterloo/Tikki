import { addParticipant } from '../../../../utils/participants'
import { routeTicketNumber, sessionPrincipal, ticketError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'

/** `{ user_id }`. Answers the new list of Participants. */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const data = await addParticipant(db, principal, routeTicketNumber(event), await readBody(event))
    setResponseStatus(event, 201)
    return { data }
  } catch (error) {
    return ticketError(error)
  }
})
