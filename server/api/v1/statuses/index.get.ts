import { restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { listStatuses } from '../../../utils/statuses'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  return { data: await listStatuses(db) }
})
