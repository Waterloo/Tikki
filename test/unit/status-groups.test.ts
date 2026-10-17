import { describe, expect, it } from 'vitest'
import type { Status, TicketSummary } from '../../app/types/tickets'
import { groupByStatus } from '../../app/utils/status'

const STATUSES: Status[] = [
  { key: 'open', name: 'Open', category: 'open' },
  { key: 'in_progress', name: 'In progress', category: 'active' },
  { key: 'resolved', name: 'Resolved', category: 'done' },
]

function ticket(number: number, status: Status): TicketSummary {
  return { number, status, ref: `GEN-${number}` } as TicketSummary
}

describe('groupByStatus', () => {
  it('makes one group for each Status in workflow order, empty ones too', () => {
    const groups = groupByStatus(STATUSES, [ticket(3, STATUSES[2]!), ticket(1, STATUSES[0]!), ticket(2, STATUSES[0]!)], { open: 2, resolved: 1 })
    expect(groups.map(g => [g.status.key, g.tickets.map(t => t.number), g.count])).toEqual([
      ['open', [1, 2], 2],
      ['in_progress', [], 0],
      ['resolved', [3], 1],
    ])
  })

  it('keeps the server count when the list was cut at its limit', () => {
    const [open] = groupByStatus(STATUSES, [ticket(1, STATUSES[0]!)], { open: 250 })
    expect(open!.count).toBe(250)
  })
})
