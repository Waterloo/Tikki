import { apiError, sessionPrincipal } from '../../../../utils/rest'
import { markRead, unreadCount } from '../../../../utils/notifications'
import { db } from '../../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || !(await markRead(db, principal, id))) return apiError(404, 'NOT_FOUND', 'No notification with this ID.')
  return { unread_count: await unreadCount(db, principal) }
})
