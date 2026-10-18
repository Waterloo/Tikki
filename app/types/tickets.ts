/** The shapes the REST API returns (server/utils/tickets.ts). */

export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type Channel = 'web' | 'ai' | 'api' | 'app'

/** The Ticket App of a change with channel `app`. Null after the app was deleted. */
export interface TicketAppRef { id: number, name: string }
export type StatusCategory = 'open' | 'active' | 'waiting' | 'done'
export type TicketAction = 'change_status' | 'change_priority' | 'assign' | 'edit_fields' | 'edit_description' | 'change_type' | 'move_team' | 'comment' | 'comment_internal' | 'cancel' | 'reopen' | 'delete' | 'manage_participants'

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

/** Who did something: a User, a Contact through its Application, or `support` (staff, as an Application sees them). */
export type Actor =
  | (Person & { kind: 'user' })
  | { kind: 'contact', contact: { id: number, external_id: string, name: string, email: string }, application: { id: number, name: string } }
  | { kind: 'support' }

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
  assigned: boolean
  /** The ticket's own Team. */
  team: { id: number, name: string }
  channel: Channel
  application: { id: number, name: string } | null
  created_at: string
  updated_at: string
}

export interface TicketDetail extends TicketSummary {
  description: string
  schema_version: number
  fields: Record<string, unknown>
  schema_fields: { key: string, label: string, type: string, required: boolean, help: string, options?: string[] }[]
  comment_count: number
  reopened_from: { number: number, ref: string } | null
  allowed_actions: TicketAction[]
  /** Only its Participants and Admins see it. */
  restricted: boolean
}

/** A Participant of a ticket (server/utils/participants.ts). */
export interface Participant extends Person {
  by_rule: 'requester' | 'assignee' | null
  added: boolean
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
  author: Actor
  channel: Channel
  ticket_app: TicketAppRef | null
  created_at: string
}

export type ActivityItem =
  | { type: 'comment', id: string, at: string, comment: CommentView }
  | {
    type: 'event'
    id: string
    at: string
    action: 'ticket_created' | 'status_changed' | 'priority_changed' | 'assignee_changed' | 'field_changed' | 'type_changed' | 'team_changed' | 'description_changed' | 'ticket_cancelled' | 'ticket_reopened' | 'attachment_added' | 'ticket_deleted' | 'ticket_restored' | 'ticket_erased' | 'participant_added' | 'participant_removed'
    principal: Actor
    channel: Channel
    ticket_app: TicketAppRef | null
    field: { key: string, label: string } | null
    before: string | null
    after: string | null
    /** For a type change: the values that did not move. */
    unmoved: { key: string, label: string, value: string }[]
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
  /** Null when an Application uploaded it (`application_id`). */
  uploader_id: string | null
  application_id: number | null
  created_at: string
  url: string
}
