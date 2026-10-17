import { downloadAttachment } from '../../../utils/attachments'
import { env } from '../../../utils/env'
import { apiError, restPrincipal } from '../../../utils/rest'
import { PolicyRefusal } from '../../../utils/policy'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await downloadAttachment(db, env.FILES, principal, getRouterParam(event, 'id') ?? '')
  } catch (error) {
    if (error instanceof PolicyRefusal) return apiError(error.refusal.status, error.refusal.code, error.refusal.message)
    throw error
  }
})
