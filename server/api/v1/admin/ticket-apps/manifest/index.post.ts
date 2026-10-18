import { env } from '../../../../../utils/env'
import { adminPrincipal, readJson, ticketAppError, validationFailed } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { createFromManifest, manifestCreateInput } from '../../../../../utils/ticket-app-manifest'

/** `{ manifest_url, hash, access?, ticket_type_ids?, page_for_requesters?, enabled? }`. `hash` is the one of the preview. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = manifestCreateInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    const app = await createFromManifest(db, env.FILES, principal, parsed.data)
    setResponseStatus(event, 201)
    return app
  } catch (error) {
    return ticketAppError(error)
  }
})
