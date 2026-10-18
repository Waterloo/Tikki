import { env } from '../../../utils/env'
import { NO_CONTACT, PolicyRefusal } from '../../../utils/policy'
import { eraseContact } from '../../../utils/privacy'
import { apiError, restPrincipal, routeId } from '../../../utils/rest'
import { db } from '../../../utils/services'

/**
 * Erasure (9.2): the owning Application, or an Admin from Settings. Answers 204, also for a Contact that is already
 * erased, so a second call finishes an Erasure whose file deletion failed.
 */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  try {
    if (id === null) throw new PolicyRefusal(NO_CONTACT)
    await eraseContact(db, env.FILES, principal, id)
    setResponseStatus(event, 204)
    return null
  } catch (error) {
    if (error instanceof PolicyRefusal) return apiError(error.refusal.status, error.refusal.code, error.refusal.message)
    throw error
  }
})
