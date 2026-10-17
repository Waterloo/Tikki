import { adminPrincipal, apiError, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { endpointPatch, updateEndpoint } from '../../../utils/webhooks'

/** Any of `name`, `url`, `events`, `include_internal`, `enabled`. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = endpointPatch.safeParse(await readBody(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  return await updateEndpoint(db, getRouterParam(event, 'id')!, parsed.data) ?? apiError(404, 'NOT_FOUND', 'No Webhook Endpoint with this ID.')
})
