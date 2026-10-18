import { applicationWebhook } from '../../../../../utils/application-webhook-route'
import { db } from '../../../../../utils/services'
import { rotateSecret } from '../../../../../utils/webhooks'

/** The response has the new secret, shown once. The old one stops at once. */
export default defineEventHandler(async (event) => {
  const found = await applicationWebhook(event)
  if (found instanceof Response) return found
  return rotateSecret(db, found.endpoint.id, found.applicationId)
})
