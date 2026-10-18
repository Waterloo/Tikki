export type Role = 'admin' | 'agent' | 'requester'

export interface NavItem {
  label: string
  icon: string
  /** A path, with a query when the item opens a filtered view. */
  to: string
  roles: readonly Role[]
}

const EVERYONE = ['admin', 'agent', 'requester'] as const
/** Admins can do everything an Agent can (3.17). */
export const STAFF = ['admin', 'agent'] as const

/** Every main sidebar item, in order. List a screen here only when its page exists. Set-up screens go in SETTINGS. */
const ITEMS: readonly NavItem[] = [
  { label: 'Inbox', icon: 'i-lucide-inbox', to: '/inbox', roles: EVERYONE },
  { label: 'My tickets', icon: 'i-lucide-ticket', to: '/', roles: EVERYONE },
  { label: 'Assigned to me', icon: 'i-lucide-user-check', to: '/tickets?filter=mine', roles: STAFF },
  { label: 'All tickets', icon: 'i-lucide-layers', to: '/tickets', roles: STAFF },
]

export interface SettingsItem {
  label: string
  icon: string
  to: string
  /** A page outside the app (the static docs site): it opens in a new tab and is never current. */
  external?: boolean
}

export interface SettingsGroup {
  label: string
  items: readonly SettingsItem[]
}

/** The Settings menu (issue 43), for Admins only. Each page keeps its own URL; the layout adds the menu around it. */
export const SETTINGS_HOME = '/admin'
const SETTINGS: readonly SettingsGroup[] = [
  { label: 'General', items: [{ label: 'Organization', icon: 'i-lucide-building-2', to: '/settings' }] },
  { label: 'People', items: [{ label: 'Teams and users', icon: 'i-lucide-users', to: '/people' }] },
  { label: 'Tickets', items: [{ label: 'Types and fields', icon: 'i-lucide-sliders-horizontal', to: '/admin/types' }] },
  { label: 'Integrations', items: [
    { label: 'Applications', icon: 'i-lucide-key-round', to: '/applications' },
    { label: 'Webhooks', icon: 'i-lucide-link', to: '/webhooks' },
    { label: 'Ticket Apps', icon: 'i-lucide-app-window', to: '/admin/apps' },
    { label: 'Developer docs', icon: 'i-lucide-book-open', to: '/docs/', external: true },
  ] },
]

export function navigationFor(role: Role | undefined): NavItem[] {
  if (!role) return []
  return ITEMS.filter(item => item.roles.includes(role))
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'agent' || value === 'requester'
}

/** Whether the item is the current page. Full path, so "All tickets" and "Assigned to me" are told apart. */
export function isCurrent(item: NavItem, fullPath: string): boolean {
  return fullPath === item.to
}

export function settingsFor(role: Role | undefined): readonly SettingsGroup[] {
  return role === 'admin' ? SETTINGS : []
}

/** Whether a Settings item is the current page. By path, so `/admin/types/3` marks Types and fields. */
export function isSettingsCurrent(item: SettingsItem, path: string): boolean {
  return !item.external && (path === item.to || path.startsWith(`${item.to}/`))
}

/** Whether the path is a page of the Settings area: the menu list, or a page of a Settings item. */
export function isSettingsPath(path: string): boolean {
  return path === SETTINGS_HOME || SETTINGS.some(group => group.items.some(item => isSettingsCurrent(item, path)))
}
