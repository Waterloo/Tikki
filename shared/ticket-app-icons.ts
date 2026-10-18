import { TYPE_ICONS } from './ticket-type-rules'

/** The built-in icons of a Ticket App: the Ticket Type set, and `app-window` first. Each is bundled (`nuxt.config.ts`). */
export const APP_ICONS = [
  { icon: 'i-lucide-app-window', label: 'App window icon' },
  ...TYPE_ICONS,
] as const

export const DEFAULT_APP_ICON = 'i-lucide-app-window'
/** Slate, the neutral color of the Ticket Type colors. */
export const DEFAULT_APP_ICON_COLOR = '#4B5563'

export const APP_ICON_MODES = ['light', 'dark'] as const
export type AppIconMode = typeof APP_ICON_MODES[number]

export const APP_ICON_MAX_BYTES = 256 * 1024
export const APP_ICON_TYPES = ['image/png', 'image/webp', 'image/svg+xml'] as const
export type AppIconType = typeof APP_ICON_TYPES[number]

/** What the API shows for the icon of an app. `kind` is `image` when a light image is stored. */
export interface TicketAppIcon {
  kind: 'builtin' | 'image'
  name: string
  color: string
  light: boolean
  dark: boolean
  /** Part of the image URL (`?v=`), so a new upload shows at once. */
  version: number
}

export function appIconUrl(appId: number, icon: TicketAppIcon, mode: AppIconMode): string {
  return `/api/v1/ticket-apps/${appId}/icon?mode=${mode}&v=${icon.version}`
}
