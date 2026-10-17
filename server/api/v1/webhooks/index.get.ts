import { adminPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { listEndpoints } from '../../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  return { data: await listEndpoints(db) }
})
