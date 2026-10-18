/** The shapes the Ticket Apps API returns (server/utils/ticket-apps.ts). */

export type TicketAppPosition = 'sidebar' | 'tab'

export interface TicketApp {
  id: number
  name: string
  url: string
  position: TicketAppPosition
  /** Null: all Ticket Types. */
  ticket_type_ids: number[] | null
  enabled: boolean
  created_at: string
}

/** An app on the ticket page. */
export type TicketAppFrame = Pick<TicketApp, 'id' | 'name' | 'url' | 'position'>

export interface ContextToken {
  token: string
  expires_at: string
  /** The context without `theme`. The page adds it. */
  data: Record<string, unknown>
}
