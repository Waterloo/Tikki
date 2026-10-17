import { createApiKey, keyCreateInput } from '../../../../../utils/applications'
import { adminPrincipal, applicationNotFound, readJson, routeId, validationFailed } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'

/** `{ name }`. The answer has the full key in `key`. It is never shown again (3.19). */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return applicationNotFound()
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = keyCreateInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  const created = await createApiKey(db, id, parsed.data.name, principal.userId)
  if (!created) return applicationNotFound()
  // The key must not stay in any cache.
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseStatus(event, 201)
  return created
})
