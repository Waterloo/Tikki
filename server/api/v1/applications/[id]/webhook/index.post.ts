import { getApplication } from '../../../../../utils/applications'
import { adminPrincipal, apiError, applicationNotFound, readJson, routeId, validationFailed } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { applicationEndpointInput, createApplicationEndpoint } from '../../../../../utils/webhooks'

/** `{ url }`. Events and internal data are fixed (422 for other values). The answer has the signing secret, shown once. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  const app = id === null ? null : await getApplication(db, id)
  if (!app) return applicationNotFound()
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = applicationEndpointInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  const created = await createApplicationEndpoint(db, app, parsed.data.url)
  if (!created) return apiError(409, 'CONFLICT', 'This Application has a Webhook Endpoint already.')
  setResponseStatus(event, 201)
  return created
})
