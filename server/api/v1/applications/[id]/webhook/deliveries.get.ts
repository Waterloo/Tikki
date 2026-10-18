import { applicationWebhook } from '../../../../../utils/application-webhook-route'
import { db } from '../../../../../utils/services'
import { listDeliveries } from '../../../../../utils/webhooks'

/** The 50 newest deliveries, without payloads. */
export default defineEventHandler(async (event) => {
  const found = await applicationWebhook(event)
  if (found instanceof Response) return found
  return { data: await listDeliveries(db, found.endpoint.id) }
})
