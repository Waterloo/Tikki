/** Rules for Ticket Types and Fields that the form (suggestions) and the server (checks) must agree on. */

/** The icons an Admin can choose. Each one is bundled into the client (`nuxt.config.ts`). */
export const TYPE_ICONS = [
  { icon: 'i-lucide-bug', label: 'Bug icon' },
  { icon: 'i-lucide-credit-card', label: 'Card icon' },
  { icon: 'i-lucide-database', label: 'Database icon' },
  { icon: 'i-lucide-key-round', label: 'Key icon' },
  { icon: 'i-lucide-user', label: 'Person icon' },
  { icon: 'i-lucide-circle-help', label: 'Question icon' },
  { icon: 'i-lucide-life-buoy', label: 'Life buoy icon' },
  { icon: 'i-lucide-ticket', label: 'Ticket icon' },
] as const

export const TYPE_COLORS = [
  { color: '#C2362F', label: 'Red' },
  { color: '#0E7377', label: 'Teal' },
  { color: '#6142C4', label: 'Violet' },
  { color: '#A14B00', label: 'Amber' },
  { color: '#1F5FD6', label: 'Blue' },
  { color: '#4B5563', label: 'Slate' },
] as const

export const PREFIX_PATTERN = /^[A-Z]{2,5}$/

/** Core attributes of a ticket. Validation errors use these names as `key`, so a Field Key must not reuse them. */
export const RESERVED_FIELD_KEYS: readonly string[] = ['title', 'description', 'priority', 'ticket_type_id', 'fields', 'status', 'assignee_id', 'body']

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

/** `Needed until` becomes `needed_until`. A label that starts with a digit gets `f_` first. */
export function keyFromLabel(label: string): string {
  let key = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (/^[0-9]/.test(key)) key = `f_${key}`
  return key.slice(0, 40).replace(/_+$/, '')
}

/** The first word if it has 5 letters or fewer, else its first 3 letters (4.9b). */
export function suggestPrefix(name: string): string {
  const word = (name.trim().split(/\s+/)[0] ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  return word.length <= 5 ? word : word.slice(0, 3)
}

export function suggestIcon(name: string): string {
  const lower = name.toLowerCase()
  if (/pay|refund|invoice|charge|billing/.test(lower)) return 'i-lucide-credit-card'
  if (/bug|error|crash|broken/.test(lower)) return 'i-lucide-bug'
  if (/data|report|extract/.test(lower)) return 'i-lucide-database'
  if (/access|permission|login|account/.test(lower)) return 'i-lucide-key-round'
  if (/onboard|offboard|hire|employee/.test(lower)) return 'i-lucide-user'
  return 'i-lucide-circle-help'
}

/** The first color that no other type uses, or the first color when all are used (4.15b). */
export function firstUnusedColor(used: readonly string[]): string {
  const taken = new Set(used.map(c => c.toUpperCase()))
  return (TYPE_COLORS.find(c => !taken.has(c.color)) ?? TYPE_COLORS[0]).color
}
