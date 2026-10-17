import { addTeamMember } from '../../../../../utils/people'
import { peopleError, peoplePrincipal, routeInt } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await addTeamMember(db, principal, routeInt(event, 'id', 'Team'), getRouterParam(event, 'userId') ?? '')
  } catch (error) {
    return peopleError(error)
  }
})
