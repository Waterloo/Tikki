import { adminPrincipal, apiError } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { getDelivery } from '../../../../../utils/webhooks'

/** One delivery with `payload`: the exact JSON text that was signed and sent. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const deliveryId = Number(getRouterParam(event, 'deliveryId'))
  const found = Number.isSafeInteger(deliveryId) ? await getDelivery(db, getRouterParam(event, 'id')!, deliveryId) : null
  return found ?? apiError(404, 'NOT_FOUND', 'No delivery with this ID.')
})
