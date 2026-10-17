import { adminPrincipal, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { organizationInput, updateOrganization } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = organizationInput.safeParse(await readBody(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  return updateOrganization(db, parsed.data)
})
