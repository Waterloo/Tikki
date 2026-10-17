import { AttachmentError } from '../../../utils/attachments'
import { PolicyRefusal } from '../../../utils/policy'
import { apiError, restPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { describeUploadLink } from '../../../utils/upload-links'

export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return await describeUploadLink(db, principal, getRouterParam(event, 'token') ?? '')
  } catch (error) {
    if (error instanceof PolicyRefusal) return apiError(error.refusal.status, error.refusal.code, error.refusal.message)
    if (error instanceof AttachmentError) return apiError(error.status, error.code, error.message)
    throw error
  }
})
