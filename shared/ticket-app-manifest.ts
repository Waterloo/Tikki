/** Issue 40: the shapes of a Ticket App manifest after Tikki read it (docs/ticket-apps.md#manifest). */

import type { AppIconType } from './ticket-app-icons'

export type ManifestPlacement = 'sidebar' | 'tab' | 'page'
export type ManifestAccess = 'read' | 'comment' | 'update'

/** An icon of the manifest: its absolute URL, and the hash and type of the bytes Tikki read. */
export interface ManifestIcon {
  url: string
  sha256: string
  type: AppIconType
}

/** A manifest with each URL resolved and each default set. Saved with the app when the Admin approves it. */
export interface NormalizedManifest {
  version: 1
  name: string
  description: string | null
  urls: Record<ManifestPlacement, string | null>
  icons: { light: ManifestIcon, dark: ManifestIcon | null } | null
  /** The access the app asks for. The Admin grants this or lower. */
  access: ManifestAccess
}

/** The keys that "Check for updates" compares. */
export const MANIFEST_KEYS = ['name', 'description', 'urls.sidebar', 'urls.tab', 'urls.page', 'icons.light', 'icons.dark', 'access'] as const
export type ManifestKey = typeof MANIFEST_KEYS[number]

/** One changed key. Icons show as their URL; `before` and `after` are null when the key is not set. */
export interface ManifestChange {
  key: ManifestKey
  before: string | null
  after: string | null
  /** A new origin in a URL, or a higher requested access. The Admin must confirm it. */
  warning: string | null
}

const RANK: Record<ManifestAccess, number> = { read: 0, comment: 1, update: 2 }

/** True when `a` gives more rights than `b`. */
export const accessAbove = (a: ManifestAccess, b: ManifestAccess) => RANK[a] > RANK[b]
