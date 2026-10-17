import { unreadCount } from '../../../utils/notifications'
import { restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'

/** One indexed count. The sidebar calls this on navigation and on a slow poll. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  return { count: await unreadCount(db, principal) }
})
