import type { Status, StatusCategory, TicketSummary } from '~/types/tickets'

/** Colors for each Status Category, light and dark. Literal class strings, so Tailwind finds them. */
export const STATUS_CLASS: Record<StatusCategory, string> = {
  open: 'bg-[#eaf1fd] text-[#1a4fb4] dark:bg-[#16223a] dark:text-[#a9c3f0]',
  active: 'bg-[#fff3e3] text-[#7a3e00] dark:bg-[#2e1d0d] dark:text-[#f4b77a]',
  waiting: 'bg-[#f2eefd] text-[#4d31a3] dark:bg-[#221a3d] dark:text-[#c4b5fd]',
  done: 'bg-[#e7f5ec] text-[#1b6136] dark:bg-[#12291b] dark:text-[#86d19f]',
}

export interface StatusGroup {
  status: Status
  tickets: TicketSummary[]
  /** All matching tickets in this Status. More than `tickets.length` when the list was cut at its limit. */
  count: number
}

/** One group for each Status, in workflow order, empty ones too. */
export function groupByStatus(statuses: Status[], tickets: TicketSummary[], counts: Record<string, number>): StatusGroup[] {
  return statuses.map((status) => {
    const inGroup = tickets.filter(t => t.status.key === status.key)
    return { status, tickets: inGroup, count: Math.max(counts[status.key] ?? 0, inGroup.length) }
  })
}
