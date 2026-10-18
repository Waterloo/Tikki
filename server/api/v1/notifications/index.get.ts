import { z } from 'zod'
import { listNotices } from '../../../utils/notifications'
import { sessionPrincipal, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'

const query = z.object({
  filter: z.enum(['all', 'unread'], { error: 'Must be all or unread.' }).optional(),
  cursor: z.coerce.number({ error: 'Must be a number.' }).int().positive().optional(),
  limit: z.coerce.number({ error: 'Must be a number.' }).int().min(1).max(100).optional(),
})

/** The User's own notices, newest first. `filter=unread`; paging with `cursor` (the `next_cursor` of the last page). */
export default defineEventHandler(async (event) => {
  const principal = await sessionPrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = query.safeParse(getQuery(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  const { data, nextCursor, unreadCount } = await listNotices(db, principal, { unreadOnly: parsed.data.filter === 'unread', cursor: parsed.data.cursor, limit: parsed.data.limit })
  return { data, unread_count: unreadCount, next_cursor: nextCursor }
})
