import { asc, desc, eq, isNull } from 'drizzle-orm'
import { schemaVersion, team, ticketType } from '../db/schema'
import type { Db } from './auth'
import { activeOptions, type FieldDef, type FieldType } from './fields'

export interface TicketTypeView {
  id: number
  name: string
  description: string
  icon: string
  color: string
  prefix: string
  team: { id: number, name: string }
  visible_to_all: boolean
}

/** A Field as a Requester or Claude sees it on a new ticket: active Fields and active options only. */
export interface FieldView {
  key: string
  label: string
  type: FieldType
  required: boolean
  help: string
  options?: string[]
}

export interface TicketTypeWithFields extends TicketTypeView {
  schema_version: number
  fields: FieldView[]
}

const columns = {
  id: ticketType.id,
  name: ticketType.name,
  description: ticketType.description,
  icon: ticketType.icon,
  color: ticketType.color,
  prefix: ticketType.prefix,
  visibleToAll: ticketType.visibleToAll,
  archivedAt: ticketType.archivedAt,
  teamId: team.id,
  teamName: team.name,
}

export type Row = Awaited<ReturnType<typeof selectTypes>>[number]

export function selectTypes(db: Db) {
  return db.select(columns).from(ticketType).leftJoin(team, eq(ticketType.teamId, team.id))
}

export function toView(row: Row): TicketTypeView {
  if (row.teamId === null || row.teamName === null) throw new Error(`Ticket Type ${row.prefix} has no Team. Every type must have one (4.13).`)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    prefix: row.prefix,
    team: { id: row.teamId, name: row.teamName },
    visible_to_all: row.visibleToAll,
  }
}

export function toFieldView(field: FieldDef): FieldView {
  const view: FieldView = { key: field.key, label: field.label, type: field.type, required: field.required, help: field.help }
  if (field.options) view.options = activeOptions(field)
  return view
}

/** The types that take new tickets. Archived types are left out (4.15f). */
export async function listTicketTypes(db: Db): Promise<TicketTypeView[]> {
  return (await selectTypes(db).where(isNull(ticketType.archivedAt)).orderBy(asc(ticketType.id))).map(toView)
}

/** The newest Schema Version of a type. New tickets use it. */
export async function currentSchemaVersion(db: Db, ticketTypeId: number) {
  const [row] = await db.select().from(schemaVersion).where(eq(schemaVersion.ticketTypeId, ticketTypeId)).orderBy(desc(schemaVersion.version)).limit(1)
  if (!row) throw new Error(`Ticket Type ${ticketTypeId} has no Schema Version. Creating a type must make version 1 (4.15a).`)
  return row
}

/** A type and its newest Schema Version, or null when no type has this ID. Archived types are included. */
export async function loadTicketType(db: Db, id: number) {
  const [row] = await selectTypes(db).where(eq(ticketType.id, id)).limit(1)
  if (!row) return null
  return { type: toView(row), archived: row.archivedAt !== null, version: await currentSchemaVersion(db, id) }
}

/** The type for readers and Claude. An archived type is not found: nobody can create tickets of it. */
export async function getTicketTypeWithFields(db: Db, id: number): Promise<TicketTypeWithFields | null> {
  const found = await loadTicketType(db, id)
  if (!found || found.archived) return null
  return { ...found.type, schema_version: found.version.version, fields: found.version.fields.filter(f => !f.archived).map(toFieldView) }
}
