import { config } from '../../../utils/env'
import { lastMailError } from '../../../utils/notice-mail'
import { adminPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { deploymentView } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const view = deploymentView(config)
  return { ...view, mail: { ...view.mail, last_error: await lastMailError(db) } }
})
