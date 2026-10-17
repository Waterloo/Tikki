import { adminPrincipal, apiError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { deleteEndpoint } from '../../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  if (!await deleteEndpoint(db, getRouterParam(event, 'id')!)) return apiError(404, 'NOT_FOUND', 'No Webhook Endpoint with this ID.')
  return new Response(null, { status: 204 })
})
