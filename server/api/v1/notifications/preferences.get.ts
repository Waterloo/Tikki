import { getPreferences } from '../../../utils/notifications'
import { sessionPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'

/** The "Email me when" switches that apply to the User's role. */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  return { data: await getPreferences(db, principal) }
})
