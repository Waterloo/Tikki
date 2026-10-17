import { renameTeam, teamInput } from '../../../utils/people'
import { peopleError, peoplePrincipal, routeInt, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = teamInput.safeParse(await readBody(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    return await renameTeam(db, principal, routeInt(event, 'id', 'Team'), parsed.data.name)
  } catch (error) {
    return peopleError(error)
  }
})
