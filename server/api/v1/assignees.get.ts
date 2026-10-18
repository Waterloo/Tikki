import { PolicyRefusal } from '../../utils/policy'
import { listAssignees } from '../../utils/assignees'
import { apiError, restPrincipal } from '../../utils/rest'
import { db } from '../../utils/services'

/** Active Agents and Admins with their Team IDs, and the Teams: what the ticket page needs to assign and move. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await listAssignees(db, principal)
  } catch (error) {
    if (error instanceof PolicyRefusal) return apiError(error.refusal.status, error.refusal.code, error.refusal.message)
    throw error
  }
})
