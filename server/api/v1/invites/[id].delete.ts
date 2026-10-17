import { revokeInvite } from '../../../utils/people'
import { peopleError, peoplePrincipal, routeInt } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  try {
    await revokeInvite(db, principal, routeInt(event, 'id', 'invite'))
    return new Response(null, { status: 204 })
  } catch (error) {
    return peopleError(error)
  }
})
