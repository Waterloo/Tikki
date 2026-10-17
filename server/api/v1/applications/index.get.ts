import { listApplications } from '../../../utils/applications'
import { adminPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  return { data: await listApplications(db) }
})
