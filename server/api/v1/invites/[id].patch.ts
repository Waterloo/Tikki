import { changeInvite, invitePatchInput } from '../../../utils/people'
import { peopleError, peoplePrincipal, routeInt, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = invitePatchInput.safeParse(await readBody(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    await changeInvite(db, principal, routeInt(event, 'id', 'invite'), parsed.data.role, parsed.data.team_ids)
    return new Response(null, { status: 204 })
  } catch (error) {
    return peopleError(error)
  }
})
