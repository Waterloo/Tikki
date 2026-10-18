import { canSeeTicketType } from '../../../utils/policy'
import { restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { listTicketTypes } from '../../../utils/ticket-types'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  return { data: (await listTicketTypes(db)).filter(t => canSeeTicketType(principal, t.id)) }
})
