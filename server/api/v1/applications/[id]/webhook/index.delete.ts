import { applicationWebhook } from '../../../../../utils/application-webhook-route'
import { db } from '../../../../../utils/services'
import { deleteEndpoint } from '../../../../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const found = await applicationWebhook(event)
  if (found instanceof Response) return found
  await deleteEndpoint(db, found.endpoint.id, found.applicationId)
  return new Response(null, { status: 204 })
})
