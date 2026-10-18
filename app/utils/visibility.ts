/** Who sees the tickets of a type (server: TICKET_VISIBILITIES). */
export type Visibility = 'requester' | 'internal' | 'participants'

export const VISIBILITIES: { value: Visibility, label: string, description: string }[] = [
  { value: 'requester', label: 'Requester only', description: 'Requesters see only their own tickets. Agents see all.' },
  { value: 'internal', label: 'All internal users', description: 'Every internal user can see these tickets.' },
  { value: 'participants', label: 'Participants only', description: 'Only the people on the ticket and Admins. Other Agents do not see it.' },
]

export function visibilityLabel(value: Visibility): string {
  return VISIBILITIES.find(v => v.value === value)?.label ?? value
}
