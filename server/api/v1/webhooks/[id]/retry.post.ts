import { adminPrincipal, apiError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { EndpointOff, retryNow } from '../../../../utils/webhooks'

/** "Retry now": sends the pending deliveries of the endpoint now. Returns the endpoint. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await retryNow(db, getRouterParam(event, 'id')!) ?? apiError(404, 'NOT_FOUND', 'No Webhook Endpoint with this ID.')
  } catch (error) {
    if (error instanceof EndpointOff) return apiError(409, 'ENDPOINT_OFF', error.message)
    throw error
  }
})
