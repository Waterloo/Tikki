import { applicationUpdateInput, updateApplication } from '../../../utils/applications'
import { adminPrincipal, applicationError, applicationNotFound, readJson, routeId, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'

/** `{ name?, description?, permissions?, ticket_type_ids?, enabled? }`. Lists replace the old list. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null) return applicationNotFound()
  const body = await readJson(event)
  if (body instanceof Response) return body
  const parsed = applicationUpdateInput.safeParse(body.value)
  if (!parsed.success) return validationFailed(parsed.error.issues)
  try {
    return (await updateApplication(db, id, parsed.data)) ?? applicationNotFound()
  } catch (error) {
    return applicationError(error)
  }
})
