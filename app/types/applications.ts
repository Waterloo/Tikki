/** The shapes the Applications API returns (server/utils/applications.ts). */

export type Permission = 'tickets:create' | 'tickets:read' | 'tickets:update' | 'comments:create'

/** Canvas labels, in the order the screen lists them. */
export const PERMISSIONS: { value: Permission, label: string }[] = [
  { value: 'tickets:create', label: 'Create tickets' },
  { value: 'tickets:read', label: 'Read its tickets' },
  { value: 'tickets:update', label: 'Cancel or reopen its tickets' },
  { value: 'comments:create', label: 'Add comments for its customers' },
]

export interface ApiKey {
  id: number
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
}

export interface ApplicationSummary {
  id: number
  name: string
  description: string
  enabled: boolean
  ticket_count: number
  last_used_at: string | null
}

export interface ApplicationDetail extends ApplicationSummary {
  rate_limit: number
  create_limit: number
  permissions: Permission[]
  ticket_types: { id: number, name: string, prefix: string, icon: string, color: string }[]
  keys: ApiKey[]
  created_at: string
}

export interface TicketTypeOption {
  id: number
  name: string
  icon: string
  color: string
}
