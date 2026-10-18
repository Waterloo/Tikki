import { applicationWebhook } from '../../../../../utils/application-webhook-route'
import { readJson, validationFailed } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { applicationEndpointPatch, updateEndpoint } from '../../../../../utils/webhooks'

/** `{ url?, enabled? }`. Events and internal data are fixed (422 for other values). */
export default defineEventHandler(async (event) => {
  const found = await applicationWebhook(event)
  if (found instanceof Response) return found
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = applicationEndpointPatch.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  const { url, enabled } = parsed.data
  return updateEndpoint(db, found.endpoint.id, { url, enabled }, found.applicationId)
})
