import { env } from '../../../utils/env'
import { adminPrincipal, apiError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { checkLogo, getOrganization, LogoError, readLogoBody, setLogo } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const request = toWebRequest(event)
    const bytes = await readLogoBody(request)
    checkLogo(request.headers.get('content-type'), bytes)
    await setLogo(env.DB, bytes)
  } catch (error) {
    if (error instanceof LogoError) return apiError(error.status, error.code, error.message)
    throw error
  }
  return getOrganization(db)
})
