import { restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { listTickets } from '../../../utils/tickets'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const requesterIsMe = getQuery(event).requester === 'me'
  return { data: await listTickets(db, principal, { requesterIsMe }) }
})
