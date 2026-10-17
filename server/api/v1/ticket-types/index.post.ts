import { adminPrincipal, typeAdminError } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { createTicketType } from '../../../utils/ticket-type-admin'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  try {
    const created = await createTicketType(db, principal, await readBody(event))
    setResponseStatus(event, 201)
    return created
  } catch (error) {
    return typeAdminError(error)
  }
})
