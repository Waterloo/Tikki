import { adminPrincipal } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { listAdminTypes } from '../../../../utils/ticket-type-admin'

// Archived types too, with the counts the Admin list shows, and the Teams for the "Owning team" select.
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const { types, teams } = await listAdminTypes(db)
  return { data: types, teams }
})
