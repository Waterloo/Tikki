import { apiError, sessionPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { appPagesFor } from '../../../utils/ticket-apps'

/** The Apps menu (issue 39): the app pages this User may open. Session only. */
export default defineEventHandler(async (event) => {
  // Like the other Ticket App routes: a request with a key or token never falls back to its cookie.
  if (event.headers.has('authorization')) return apiError(403, 'FORBIDDEN', 'App pages need a web session. An API key cannot list them.')
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  return { data: await appPagesFor(db, principal) }
})
