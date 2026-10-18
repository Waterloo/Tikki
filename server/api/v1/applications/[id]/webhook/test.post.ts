import { applicationWebhook } from '../../../../../utils/application-webhook-route'
import { apiError } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { EndpointOff, sendTestEvent } from '../../../../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const found = await applicationWebhook(event)
  if (found instanceof Response) return found
  try {
    return await sendTestEvent(db, found.endpoint.id, found.applicationId)
  } catch (error) {
    if (error instanceof EndpointOff) return apiError(409, 'ENDPOINT_OFF', error.message)
    throw error
  }
})
