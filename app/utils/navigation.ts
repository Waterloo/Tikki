export type Role = 'admin' | 'agent' | 'requester'

export interface NavItem {
  label: string
  icon: string
  /** A path, with a query when the item opens a filtered view. */
  to: string
  roles: readonly Role[]
  /** Also current on the pages under `to`, for example `/applications/3`. */
  prefix?: boolean
}

const EVERYONE = ['admin', 'agent', 'requester'] as const
/** Admins can do everything an Agent can (3.17). */
export const STAFF = ['admin', 'agent'] as const

/** Every sidebar item, in order. List a screen here only when its page exists. */
const ITEMS: readonly NavItem[] = [
  { label: 'Inbox', icon: 'i-lucide-inbox', to: '/inbox', roles: EVERYONE },
  { label: 'My tickets', icon: 'i-lucide-ticket', to: '/', roles: EVERYONE },
  { label: 'Assigned to me', icon: 'i-lucide-user-check', to: '/tickets?filter=mine', roles: STAFF },
  { label: 'All tickets', icon: 'i-lucide-layers', to: '/tickets', roles: STAFF },
  { label: 'New ticket', icon: 'i-lucide-plus', to: '/tickets/new', roles: EVERYONE },
  { label: 'Types and fields', icon: 'i-lucide-sliders-horizontal', to: '/admin/types', roles: ['admin'] },
  { label: 'Teams and users', icon: 'i-lucide-users', to: '/people', roles: ['admin'] },
  { label: 'Applications', icon: 'i-lucide-key-round', to: '/applications', roles: ['admin'], prefix: true },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings', roles: ['admin'] },
]

export function navigationFor(role: Role | undefined): NavItem[] {
  if (!role) return []
  return ITEMS.filter(item => item.roles.includes(role))
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'agent' || value === 'requester'
}

/** Whether the item is the current page. Full path, so "All tickets" and "Assigned to me" are told apart. */
export function isCurrent(item: NavItem, fullPath: string, path: string): boolean {
  return fullPath === item.to || (!!item.prefix && path.startsWith(`${item.to}/`))
}
