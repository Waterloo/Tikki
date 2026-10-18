import { authorizeRestore } from '../../../utils/policy'
import { listDeletedTickets } from '../../../utils/privacy'
import { apiError, restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'

/** The soft-deleted tickets, newest first (Admins). The one place where they are visible. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const refusal = authorizeRestore(principal)
  if (refusal) return apiError(refusal.status, refusal.code, refusal.message)
  return { data: await listDeletedTickets(db) }
})
