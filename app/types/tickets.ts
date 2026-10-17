/** The shapes the REST API returns (server/utils/tickets.ts). */

export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type Channel = 'web' | 'ai' | 'api'
export type StatusCategory = 'open' | 'active' | 'waiting' | 'done'
export type TicketAction = 'change_status' | 'change_priority' | 'assign' | 'edit_fields' | 'edit_description' | 'comment' | 'comment_internal' | 'cancel' | 'reopen'

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

export interface TicketSummary {
  number: number
  ref: string
  title: string
  priority: Priority
  status: Status
  ticket_type: { id: number, name: string, prefix: string, icon: string, color: string }
  requester: Person
  assignee: Person | null
  channel: Channel
  created_at: string
  updated_at: string
}

export interface TicketDetail extends TicketSummary {
  description: string
  schema_version: number
  fields: Record<string, unknown>
  schema_fields: { key: string, label: string, type: string, required: boolean, help: string, options?: string[] }[]
  team: { id: number, name: string }
  comment_count: number
  reopened_from: { number: number, ref: string } | null
  allowed_actions: TicketAction[]
}

export interface TicketList {
  data: TicketSummary[]
  counts: Record<string, number>
  next_cursor: string | null
}

export interface CommentView {
  id: string
  visibility: 'public' | 'internal'
  body: string
  author: Person
  channel: Channel
  created_at: string
}

export type ActivityItem =
  | { type: 'comment', id: string, at: string, comment: CommentView }
  | {
    type: 'event'
    id: string
    at: string
    action: 'ticket_created' | 'status_changed' | 'priority_changed' | 'assignee_changed' | 'field_changed' | 'description_changed' | 'ticket_cancelled' | 'ticket_reopened'
    principal: Person
    channel: Channel
    field: { key: string, label: string } | null
    before: string | null
    after: string | null
    erased: boolean
    reverts_id: number | null
    reverted: boolean
    revertible: boolean
  }
