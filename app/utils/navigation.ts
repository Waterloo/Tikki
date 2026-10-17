import type { NavigationMenuItem } from '@nuxt/ui'

export type Role = 'admin' | 'agent' | 'requester'

interface NavItem {
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
]

export function navigationFor(role: Role | undefined): NavigationMenuItem[] {
  if (!role) return []
  return ITEMS.filter(item => item.roles.includes(role)).map(({ label, icon, to }) => ({ label, icon, to }))
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'agent' || value === 'requester'
}
