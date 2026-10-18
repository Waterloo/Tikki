import { adminPrincipal, readJson, ticketAppError, validationFailed } from '../../../../../utils/rest'
import { manifestPreviewInput, previewOf, readManifest } from '../../../../../utils/ticket-app-manifest'

/** `{ manifest_url }`. Fetches and checks the manifest and its icons. Saves nothing, and writes no audit entry. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = manifestPreviewInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    return previewOf(await readManifest(parsed.data.manifest_url))
  } catch (error) {
    return ticketAppError(error)
  }
})
