import { apiError, restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { MAX_SEARCH_LENGTH, similarTickets } from '../../../utils/tickets'

/** `?title=`: a few open tickets with a similar title, for the new-ticket form. Only tickets the caller can read. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const title = getQuery(event).title
  if (typeof title !== 'string' || title.length > MAX_SEARCH_LENGTH) {
    return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', [
      { key: 'title', label: 'Title', reason: `Send the title as text of ${MAX_SEARCH_LENGTH} characters or fewer.` },
    ])
  }
  return { data: await similarTickets(db, principal, title) }
})
