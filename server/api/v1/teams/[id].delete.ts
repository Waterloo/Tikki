import { deleteTeam } from '../../../utils/people'
import { peopleError, peoplePrincipal, routeInt } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  try {
    await deleteTeam(db, principal, routeInt(event, 'id', 'Team'))
    return new Response(null, { status: 204 })
  } catch (error) {
    return peopleError(error)
  }
})
