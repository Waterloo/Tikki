import { accessAbove } from '~~/shared/ticket-app-manifest'
import type { TicketAppAccess } from '~/types/ticket-apps'

export const TICKET_APP_ACCESS_ITEMS: { value: TicketAppAccess, label: string, description: string }[] = [
  { value: 'read', label: 'Read', description: 'The app\'s backend can read the ticket, its comments and its Activity.' },
  { value: 'comment', label: 'Comment', description: 'Also add Public Comments and Internal Comments.' },
  { value: 'update', label: 'Update', description: 'Also change the Status, Priority, assignee and Fields.' },
]

export const TICKET_APP_ACCESS_LABEL: Record<TicketAppAccess, string> = { read: 'Read', comment: 'Comment', update: 'Update' }

/** The access choices. With a manifest (issue 40), a level above the requested one is off: the Admin cannot grant it. */
export function accessItems(requested: TicketAppAccess | null) {
  return TICKET_APP_ACCESS_ITEMS.map(item => requested && accessAbove(item.value, requested)
    ? { ...item, disabled: true, description: `${item.description} The app does not ask for this.` }
    : item)
}
