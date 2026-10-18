import { findContacts } from '../../../utils/privacy'
import { adminPrincipal, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'

/** Admins find a Contact for Erasure: `?email=` or `?external_id=`, exact match. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const query = getQuery(event)
  const email = typeof query.email === 'string' ? query.email.trim() : ''
  const externalId = typeof query.external_id === 'string' ? query.external_id.trim() : ''
  if (!email === !externalId) return validationFailed([{ path: ['email'], message: 'Send either email or external_id.' }])
  const found = await findContacts(db, email ? { email } : { externalId })
  return { data: found.contacts, users: found.users }
})
