/** The shapes the REST API returns (server/utils/notifications.ts). */

import type { Priority } from './tickets'

export type NoticeKind = 'ticket_created' | 'assigned' | 'public_comment' | 'internal_comment' | 'status_changed' | 'webhook_failing' | 'webhook_disabled'

export interface Notice {
  id: number
  kind: NoticeKind
  head: string
  body: string
  href: string
  read: boolean
  created_at: string
  ticket: { ref: string, ticket_type: { name: string, icon: string, color: string }, priority: Priority } | null
}

export interface NoticeList {
  data: Notice[]
  unread_count: number
  next_cursor: number | null
}

export interface Preference {
  key: 'team_ticket' | 'assigned' | 'public_comment' | 'internal_comment' | 'status_changed' | 'webhook'
  enabled: boolean
  locked: boolean
}
