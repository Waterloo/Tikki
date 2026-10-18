/** The shapes the Ticket Apps API returns (server/utils/ticket-apps.ts). */

export type TicketAppPlacement = 'sidebar' | 'tab' | 'page'
/** The placements inside a ticket. */
export type FramePlacement = 'sidebar' | 'tab'
export type TicketAppAccess = 'read' | 'comment' | 'update'

/** The URL of each placement. Null: the placement is off. */
export type TicketAppUrls = Record<TicketAppPlacement, string | null>

export interface TicketApp {
  id: number
  name: string
  urls: TicketAppUrls
  /** Null: all Ticket Types. */
  ticket_type_ids: number[] | null
  access: TicketAppAccess
  enabled: boolean
  created_at: string
}

/** An app on the ticket page. */
export type TicketAppFrame = Pick<TicketApp, 'id' | 'name' | 'urls'>

export interface ContextToken {
  token: string
  expires_at: string
  /** The context without `theme`. The page adds it. */
  data: Record<string, unknown>
}
