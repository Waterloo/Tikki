import { adminPrincipal, apiError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { getEndpoint, listDeliveries } from '../../../../utils/webhooks'

/** The 50 newest deliveries, without payloads. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = getRouterParam(event, 'id')!
  if (!await getEndpoint(db, id)) return apiError(404, 'NOT_FOUND', 'No Webhook Endpoint with this ID.')
  return { data: await listDeliveries(db, id) }
})
