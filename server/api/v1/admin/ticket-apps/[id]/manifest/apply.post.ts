import { env } from '../../../../../../utils/env'
import { adminPrincipal, apiError, readJson, routeId, ticketAppError, validationFailed } from '../../../../../../utils/rest'
import { db } from '../../../../../../utils/services'
import { applyManifestUpdate, manifestApplyInput } from '../../../../../../utils/ticket-app-manifest'

/** `{ hash, access?, confirm_warnings? }`. Applies the update of the last check. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return apiError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = manifestApplyInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    return await applyManifestUpdate(db, env.FILES, principal, id, parsed.data)
  } catch (error) {
    return ticketAppError(error)
  }
})
