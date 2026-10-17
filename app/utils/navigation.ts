export type Role = 'admin' | 'agent' | 'requester'

export interface NavItem {
  label: string
  icon: string
  to: string
  roles: readonly Role[]
}

const EVERYONE = ['admin', 'agent', 'requester'] as const

/** Every sidebar item, in order. List a screen here only when its page exists. */
const ITEMS: readonly NavItem[] = [
  { label: 'My tickets', icon: 'i-lucide-ticket', to: '/', roles: EVERYONE },
  { label: 'New ticket', icon: 'i-lucide-plus', to: '/tickets/new', roles: EVERYONE },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings', roles: ['admin'] },
]

export function navigationFor(role: Role | undefined): NavItem[] {
  if (!role) return []
  return ITEMS.filter(item => item.roles.includes(role))
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'agent' || value === 'requester'
}
