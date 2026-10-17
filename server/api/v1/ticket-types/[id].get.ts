import { apiError, restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { getTicketTypeWithFields } from '../../../utils/ticket-types'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const id = /^[1-9]\d{0,15}$/.test(getRouterParam(event, 'id') ?? '') ? Number(getRouterParam(event, 'id')) : null
  const found = id === null ? null : await getTicketTypeWithFields(db, id)
  return found ?? apiError(404, 'NOT_FOUND', 'No Ticket Type has this ID.')
})
