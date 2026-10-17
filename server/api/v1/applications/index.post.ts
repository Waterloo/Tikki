import { applicationCreateInput, createApplication } from '../../../utils/applications'
import { adminPrincipal, applicationError, readJson, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'

/** `{ name, description?, permissions?, ticket_type_ids? }`. A new Application has no keys and is enabled. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = applicationCreateInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    setResponseStatus(event, 201)
    return await createApplication(db, parsed.data)
  } catch (error) {
    return applicationError(error)
  }
})
