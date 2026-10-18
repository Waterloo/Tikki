import { adminPrincipal } from '../../../../utils/rest'
import { db } from '../../../../utils/services'
import { listTicketApps } from '../../../../utils/ticket-apps'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  return { data: await listTicketApps(db) }
})
