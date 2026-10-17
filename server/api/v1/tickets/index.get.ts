import { apiError, restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { listTickets, type ListFilter } from '../../../utils/tickets'

const ASSIGNEE_FILTERS = ['me', 'none'] as const

/** `?requester=me`: only the caller's own tickets. `?assignee=me|none`: assigned to the caller, or unassigned. */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const query = getQuery(event)
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
