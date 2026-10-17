/** The shapes the Ticket Type editor API returns (server/utils/ticket-type-admin.ts). */

export type FieldType = 'short_text' | 'long_text' | 'number' | 'date' | 'single_select' | 'multi_select' | 'checkbox' | 'user' | 'url' | 'file'

export interface FieldOption {
  value: string
  archived?: boolean
}

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required: boolean
  help: string
  options?: FieldOption[]
  archived?: boolean
}

/** A Field in the editor. `isNew` marks a Field that the Admin added and has not saved yet. */
export interface DraftField extends FieldDef {
  isNew?: boolean
}

export interface AdminTeam {
  id: number
  name: string
}

export interface AdminType {
  id: number
  name: string
  description: string
  icon: string
  color: string
  prefix: string
  team: AdminTeam
  visible_to_all: boolean
  archived_at: string | null
  schema_version: number
  field_count: number
  open_tickets: number
  ticket_count: number
}

export interface AdminTypeDetail extends AdminType {
  fields: FieldDef[]
}

export interface AdminTypeList {
  data: AdminType[]
  teams: AdminTeam[]
}

export interface Problem {
  key: string
  reason: string
  restore_type_id?: number
}
