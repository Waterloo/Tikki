/** The shapes the Ticket Apps API returns (server/utils/ticket-apps.ts). */

import type { TicketAppIcon } from '~~/shared/ticket-app-icons'
import type { ManifestChange, NormalizedManifest } from '~~/shared/ticket-app-manifest'

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
  icon: TicketAppIcon
  /** Requesters also see the page (issue 39). */
  page_for_requesters: boolean
  /** Added from this manifest (issue 40). `access` is the access the app asks for. */
  manifest: { url: string, description: string | null, access: TicketAppAccess } | null
  created_at: string
}

/** A checked manifest (issue 40). The icons are `data:` URLs from Tikki. */
export interface ManifestPreview {
  manifest_url: string
  hash: string
  manifest: NormalizedManifest
  icons: { light: string, dark: string | null } | null
}

/** "Check for updates". `changes` is empty when nothing changed. */
export interface ManifestCheck extends ManifestPreview {
  changes: ManifestChange[]
  granted_access: TicketAppAccess
}

/** An app on the ticket page. */
export type TicketAppFrame = Pick<TicketApp, 'id' | 'name' | 'urls' | 'icon'>

export interface ContextToken {
  token: string
  expires_at: string
  /** The context without `theme`. The page adds it. */
  data: Record<string, unknown>
}

/** An entry of the Apps menu (issue 39). `url` is the page URL. */
export interface AppPage {
  id: number
  name: string
  url: string
  icon: TicketAppIcon
}
