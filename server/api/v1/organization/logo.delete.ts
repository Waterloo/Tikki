import { env } from '../../../utils/env'
import { adminPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { clearLogo, getOrganization } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  await clearLogo(env.DB)
  return getOrganization(db)
})
