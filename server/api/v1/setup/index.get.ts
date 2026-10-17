import { config } from '../../../utils/env'
import { adminPrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { hasTickets } from '../../../utils/settings'
import { listTicketTypes } from '../../../utils/ticket-types'

// What the first-run screen shows, in one request.
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const first_ticket_exists = await hasTickets(db)
  return {
    first_ticket_exists,
    connector_url: config.mcpResource,
    allowed_domains: config.allowedEmailDomains,
    ticket_types: first_ticket_exists ? [] : await listTicketTypes(db),
  }
})
