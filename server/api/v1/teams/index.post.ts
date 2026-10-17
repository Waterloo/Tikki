import { createTeam, teamInput } from '../../../utils/people'
import { peopleError, peoplePrincipal, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = teamInput.safeParse(await readBody(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    const created = await createTeam(db, principal, parsed.data.name)
    setResponseStatus(event, 201)
    return created
  } catch (error) {
    return peopleError(error)
  }
})
