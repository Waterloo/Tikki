import { authorizeList } from '../../../utils/policy'
import { apiError, restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { listTickets, type ListFilter } from '../../../utils/tickets'

const ASSIGNEE_FILTERS = ['me', 'none'] as const

/**
 * `?requester=me`: only the caller's own tickets. `?assignee=me|none`: assigned to the caller, or unassigned.
 * The filters are for Users. An Application gets the tickets it created.
 */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const refusal = authorizeList(principal)
  if (refusal) return apiError(refusal.status, refusal.code, refusal.message)
  const query = getQuery(event)
  if (principal.kind === 'application' && (query.requester !== undefined || query.assignee !== undefined)) {
    return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', [
      { key: 'requester', label: 'Requester', reason: 'The requester and assignee filters are only for Users. An Application gets the tickets it created.' },
    ])
  }
  const assignee = ASSIGNEE_FILTERS.find(f => f === query.assignee)
  if (query.assignee !== undefined && !assignee) {
    return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', [
      { key: 'assignee', label: 'Assignee', reason: 'Must be one of the options.', options: [...ASSIGNEE_FILTERS] },
    ])
  }
  const filter: ListFilter = { requesterIsMe: query.requester === 'me', assignee }
  const { tickets, counts } = await listTickets(db, principal, filter)
  return { data: tickets, counts }
})
