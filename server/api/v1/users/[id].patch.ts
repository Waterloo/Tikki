import { changeRole, deactivateUser, reactivateUser, userPatchInput } from '../../../utils/people'
import { peopleError, peoplePrincipal, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = userPatchInput.safeParse(await readBody(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  const id = getRouterParam(event, 'id') ?? ''
  try {
    if (parsed.data.role) await changeRole(db, principal, id, parsed.data.role)
    else if (parsed.data.active) await reactivateUser(db, principal, id)
    else await deactivateUser(db, principal, id)
    return { data: (await listPeople(db)).find(p => p.id === id) }
  } catch (error) {
    return peopleError(error)
  }
})
