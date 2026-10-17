/** The shapes the REST API returns (server/utils/tickets.ts). */

export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type Channel = 'web' | 'ai' | 'api'
export type StatusCategory = 'open' | 'active' | 'waiting' | 'done'
export type TicketAction = 'change_status' | 'change_priority' | 'assign' | 'edit_fields' | 'comment' | 'comment_internal'

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
  schema_fields: { key: string, label: string, type: string }[]
  team: { id: number, name: string }
  comment_count: number
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
    action: 'ticket_created' | 'status_changed' | 'priority_changed' | 'assignee_changed' | 'field_changed' | 'attachment_added'
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

/** A file of a ticket, or an upload that no ticket owns yet (`ticket_number` null). */
export interface Attachment {
  id: string
  ticket_number: number | null
  filename: string
  content_type: string
  size: number
  uploader_id: string
  created_at: string
  url: string
}
