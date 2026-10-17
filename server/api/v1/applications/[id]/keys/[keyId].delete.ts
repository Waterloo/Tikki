import { revokeApiKey } from '../../../../../utils/applications'
import { adminPrincipal, apiError, routeId } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'

/** Revokes the key. The next request with it is refused. The row stays, for the record. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  const keyId = routeId(event, 'keyId')
  if (id === null || keyId === null || !(await revokeApiKey(db, id, keyId))) return apiError(404, 'NOT_FOUND', 'This Application has no active key with this ID.')
  setResponseStatus(event, 204)
  return null
})
