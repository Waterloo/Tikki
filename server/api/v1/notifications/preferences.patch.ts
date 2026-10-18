import { PreferenceError, setPreferences } from '../../../utils/notifications'
import { apiError, sessionPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'

/** `{ <key>: boolean, ... }`. `assigned` cannot be turned off. Email sending comes with issue 19. */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return { data: await setPreferences(db, principal, await readBody(event)) }
  } catch (error) {
    if (error instanceof PreferenceError) return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', [{ key: error.key, reason: error.reason }])
    throw error
  }
})
