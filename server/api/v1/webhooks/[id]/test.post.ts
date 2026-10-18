import { adminPrincipal, apiError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { EndpointOff, sendTestEvent } from '../../../../utils/webhooks'

/** Sends a `webhook.test` Event now and returns its delivery, with the result of the first attempt. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await sendTestEvent(db, getRouterParam(event, 'id')!) ?? apiError(404, 'NOT_FOUND', 'No Webhook Endpoint with this ID.')
  } catch (error) {
    if (error instanceof EndpointOff) return apiError(409, 'ENDPOINT_OFF', error.message)
    throw error
  }
})
