import { config } from '../../../../utils/env'
import { resendInvite } from '../../../../utils/people'
import { peopleError, peoplePrincipal, routeInt } from '../../../../utils/rest'
import { db, useMail } from '../../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  try {
    await resendInvite(db, { mail: useMail(), config }, principal, routeInt(event, 'id', 'invite'))
    return new Response(null, { status: 204 })
  } catch (error) {
    return peopleError(error)
  }
})
