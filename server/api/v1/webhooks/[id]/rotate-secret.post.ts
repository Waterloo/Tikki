import { adminPrincipal, apiError } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { rotateSecret } from '../../../../utils/webhooks'

/** The response has the new secret, the only time it is shown. The old one stops at once. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  return await rotateSecret(db, getRouterParam(event, 'id')!) ?? apiError(404, 'NOT_FOUND', 'No Webhook Endpoint with this ID.')
})
