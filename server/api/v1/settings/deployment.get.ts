import { config } from '../../../utils/env'
import { adminPrincipal } from '../../../utils/rest'
import { deploymentView } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  return deploymentView(config)
})
