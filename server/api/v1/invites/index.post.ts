import { config } from '../../../utils/env'
import { createInvites, inviteInput } from '../../../utils/people'
import { peopleError, peoplePrincipal, validationFailed } from '../../../utils/rest'
import { db, useMail } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = inviteInput.safeParse(await readBody(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    const invited = await createInvites(db, { mail: useMail(), config }, principal, parsed.data.emails)
    setResponseStatus(event, 201)
    return { invited }
  } catch (error) {
    return peopleError(error)
  }
})
