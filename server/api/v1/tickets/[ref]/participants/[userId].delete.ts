import { removeParticipant } from '../../../../../utils/participants'
import { routeTicketNumber, sessionPrincipal, ticketError } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'

/** Answers the new list of Participants. */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return { data: await removeParticipant(db, principal, routeTicketNumber(event), getRouterParam(event, 'userId') ?? '') }
  } catch (error) {
    return ticketError(error)
  }
})
