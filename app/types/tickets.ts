/** The shapes the REST API returns (server/utils/tickets.ts). */

export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type Channel = 'web' | 'ai' | 'api'
export type StatusCategory = 'open' | 'active' | 'waiting' | 'done'
export type TicketAction = 'change_status' | 'change_priority' | 'assign'

export interface Status {
  key: string
  name: string
  category: StatusCategory
}

export interface Person {
  id: string
  name: string
  email: string
}

/** A User, or a Contact of an Application. */
export type Requester =
  | (Person & { kind: 'user' })
  | { kind: 'contact', id: number, external_id: string, name: string, email: string }

export interface TicketSummary {
  number: number
  ref: string
  title: string
  priority: Priority
  status: Status
  ticket_type: { id: number, name: string, prefix: string, icon: string, color: string }
  requester: Requester
  assignee: Person | null
  channel: Channel
  application: { id: number, name: string } | null
  created_at: string
  updated_at: string
}

export interface TicketDetail extends TicketSummary {
  description: string
  schema_version: number
  fields: Record<string, unknown>
  schema_fields: { key: string, label: string, type: string }[]
  team: { id: number, name: string }
  allowed_actions: TicketAction[]
}

export interface TicketList {
  data: TicketSummary[]
  counts: Record<string, number>
}
