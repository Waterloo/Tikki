import { markAllRead } from '../../../utils/notifications'
import { sessionPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  await markAllRead(db, principal)
  return { unread_count: 0 }
})
