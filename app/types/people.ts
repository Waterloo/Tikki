import type { Role } from '~/utils/navigation'

export interface PersonRow {
  id: string | null
  invite_id: number | null
  name: string
  email: string
  role: Role
  status: 'active' | 'deactivated' | 'invited' | 'expired'
  last_active_at: string | null
  teams: { id: number, name: string }[]
}

export interface TeamView {
  id: number
  name: string
  members: { id: string, name: string, email: string, role: Role }[]
  owns: { id: number, name: string, prefix: string, icon: string, color: string }[]
}
