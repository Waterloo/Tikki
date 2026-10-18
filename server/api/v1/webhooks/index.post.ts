import { adminPrincipal, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { createEndpoint, endpointInput } from '../../../utils/webhooks'

/** `{ name, url, events?, include_internal? }`. The response has the signing secret, the only time it is shown. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = endpointInput.safeParse(await readBody(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  setResponseStatus(event, 201)
  return createEndpoint(db, parsed.data)
})
