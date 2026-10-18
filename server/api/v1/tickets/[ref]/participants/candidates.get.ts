import { participantCandidates } from '../../../../../utils/participants'
import { routeTicketNumber, sessionPrincipal, ticketError } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'

/** `?q=` name or email. Active Users who can be added, for those who may add. */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const q = getQuery(event).q
    return { data: await participantCandidates(db, principal, routeTicketNumber(event), typeof q === 'string' ? q : '') }
  } catch (error) {
    return ticketError(error)
  }
})
