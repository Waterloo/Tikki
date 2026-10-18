import { applicationWebhook } from '../../../../../../utils/application-webhook-route'
import { apiError } from '../../../../../../utils/rest'
import { db } from '../../../../../../utils/services'
import { getDelivery } from '../../../../../../utils/webhooks'

/** One delivery with `payload`: the exact JSON text that was signed and sent. */
export default defineEventHandler(async (event) => {
  const found = await applicationWebhook(event)
  if (found instanceof Response) return found
  const deliveryId = Number(getRouterParam(event, 'deliveryId'))
  const delivery = Number.isSafeInteger(deliveryId) ? await getDelivery(db, found.endpoint.id, deliveryId, found.applicationId) : null
  return delivery ?? apiError(404, 'NOT_FOUND', 'No delivery with this ID.')
})
