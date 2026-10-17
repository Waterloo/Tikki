import { asc, count, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { schemaVersion, status, team, ticket, ticketType, ticketTypeOldPrefix } from '../db/schema'
import { FIELD_KEY_PATTERN, firstUnusedColor, keyFromLabel, PREFIX_PATTERN, RESERVED_FIELD_KEYS, suggestIcon, suggestPrefix, TYPE_COLORS, TYPE_ICONS } from '../../shared/ticket-type-rules'
import type { Db } from './auth'
import { FIELD_TYPES, type FieldDef, type FieldOption } from './fields'
import { currentSchemaVersion, selectTypes, toView, type TicketTypeView } from './ticket-types'

/** One problem with the input. `key` is the input name, or `fields.<index>.<name>` for a Field. */
export interface Problem {
  key: string
  reason: string
  /** For a name that an archived type uses: the type to restore instead. */
  restore_type_id?: number
}

export class TypeAdminError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
    readonly details: Problem[] | null = null,
  ) {
    super(message)
    this.name = 'TypeAdminError'
  }
}

function invalid(problems: Problem[]): TypeAdminError {
  return new TypeAdminError(422, 'VALIDATION_FAILED', 'The request has invalid values.', problems)
}

export interface AdminTypeRow extends TicketTypeView {
  archived_at: string | null
  schema_version: number
  /** Active Fields of the newest Schema Version. */
  field_count: number
  /** Tickets not in the `done` Status Category. */
  open_tickets: number
  ticket_count: number
}

/** The type with every Field of its newest Schema Version, archived ones too. */
export interface AdminTypeDetail extends AdminTypeRow {
  fields: FieldDef[]
}

export interface AdminTeam {
  id: number
  name: string
}

const ICONS = new Set<string>(TYPE_ICONS.map(i => i.icon))
const COLORS = new Set<string>(TYPE_COLORS.map(c => c.color))
const MAX_FIELDS = 50
const MAX_OPTIONS = 100

const text = (message = 'Must be text.') => z.string({ error: message })

const optionInput = z.union([text(), z.strictObject({ value: text(), archived: z.boolean().optional() })], { error: 'Each option must be text.' })

const fieldInput = z.strictObject({
  key: text().optional(),
  label: text('Label is required.'),
  type: z.enum(FIELD_TYPES, { error: `Must be one of: ${FIELD_TYPES.join(', ')}.` }),
  required: z.boolean({ error: 'Must be true or false.' }).optional(),
  help: text().optional(),
  options: z.array(optionInput, { error: 'Must be a list.' }).optional(),
  archived: z.boolean({ error: 'Must be true or false.' }).optional(),
}, { error: 'Each Field must be an object with a label and a data type.' })

type FieldInput = z.infer<typeof fieldInput>

const settings = {
  name: text('Name is required.').trim().min(1, 'Name is required.').max(60, 'Name must be 60 characters or fewer.'),
  prefix: text().trim().toUpperCase().regex(PREFIX_PATTERN, 'Use 2 to 5 letters.'),
  description: text('Say when to use this type.').trim().min(1, 'Say when to use this type.').max(300, 'Must be 300 characters or fewer.'),
  icon: text().refine(v => ICONS.has(v), 'Choose one of the icons.'),
  color: text().refine(v => COLORS.has(v.toUpperCase()), 'Choose one of the colors.'),
  team_id: z.number({ error: 'Choose a Team.' }).int('Choose a Team.').positive('Choose a Team.'),
  visible_to_all: z.boolean({ error: 'Must be true or false.' }),
}

const fieldsInput = z.array(fieldInput, { error: 'Must be a list of Fields.' }).max(MAX_FIELDS, `A type has at most ${MAX_FIELDS} Fields.`)
const unknownKeys = (issue: { code: string, keys?: string[] }) => issue.code === 'unrecognized_keys' ? `Unknown: ${issue.keys?.join(', ')}.` : 'Must be an object.'

const createInput = z.strictObject({
  name: settings.name,
  description: settings.description,
  prefix: settings.prefix.optional(),
  icon: settings.icon.optional(),
  color: settings.color.optional(),
  team_id: settings.team_id.optional(),
  visible_to_all: settings.visible_to_all.optional(),
  fields: fieldsInput.optional(),
}, { error: unknownKeys })

const updateInput = z.strictObject({
  name: settings.name.optional(),
  description: settings.description.optional(),
  prefix: settings.prefix.optional(),
  icon: settings.icon.optional(),
  color: settings.color.optional(),
  team_id: settings.team_id.optional(),
  visible_to_all: settings.visible_to_all.optional(),
  archived: z.boolean({ error: 'Must be true or false.' }).optional(),
  fields: fieldsInput.optional(),
  /** The `schema_version` the Admin edited. A save of Fields from an older version is refused. */
  base_version: z.number({ error: 'Must be a version number.' }).int().positive().optional(),
}, { error: unknownKeys })

function toProblems(issues: z.core.$ZodIssue[]): Problem[] {
  return issues.map(i => ({ key: i.path.length ? i.path.join('.') : 'body', reason: i.message }))
}

function canonOption(o: FieldOption): FieldOption {
  return o.archived ? { value: o.value, archived: true } : { value: o.value }
}

/** One fixed property order, so two equal Fields compare equal as JSON. */
function canonField(f: FieldDef): FieldDef {
  const out: FieldDef = { key: f.key, label: f.label, type: f.type, required: f.required, help: f.help }
  if (f.options) out.options = f.options.map(canonOption)
  if (f.archived) out.archived = true
  return out
}

/** Turns the Fields of a request into Field definitions, or lists every problem. Key rules: a new key comes from the label. */
function buildFields(inputs: FieldInput[]): { fields: FieldDef[], problems: Problem[] } {
  const problems: Problem[] = []
  const fields: FieldDef[] = []
  const seen = new Map<string, number>()

  inputs.forEach((input, i) => {
    const at = (name: string, reason: string) => problems.push({ key: `fields.${i}.${name}`, reason })
    const label = input.label.trim()
    if (!label) at('label', 'Label is required.')
    else if (label.length > 80) at('label', 'Label must be 80 characters or fewer.')

    const key = input.key?.trim() || keyFromLabel(label)
    if (!key) at('key', 'The key is made from the label. Add letters or digits to the label.')
    else if (!FIELD_KEY_PATTERN.test(key)) at('key', 'A key starts with a letter and has lowercase letters, digits and underscores, up to 40 characters.')
    else if (RESERVED_FIELD_KEYS.includes(key)) at('key', `The key ${key} is reserved for a core attribute of a ticket. Change the label.`)
    else if (seen.has(key)) at('key', `The key ${key} is already used by another Field. Change the label.`)
    if (key) seen.set(key, i)

    const help = (input.help ?? '').trim()
    if (help.length > 300) at('help', 'Help text must be 300 characters or fewer.')

    const def: FieldDef = { key, label, type: input.type, required: input.required ?? false, help }
    const isSelect = input.type === 'single_select' || input.type === 'multi_select'
    if (isSelect) {
      const options: FieldOption[] = (input.options ?? []).map(o => typeof o === 'string' ? { value: o.trim() } : { value: o.value.trim(), ...(o.archived ? { archived: true } : {}) })
      const values = options.map(o => o.value)
      if (options.length === 0) at('options', 'Add at least one option.')
      else if (options.length > MAX_OPTIONS) at('options', `A Field has at most ${MAX_OPTIONS} options.`)
      else if (values.some(v => !v || v.length > 100)) at('options', 'Each option must have 1 to 100 characters.')
      else if (new Set(values).size !== values.length) at('options', 'Each option must be different.')
      def.options = options
    } else if (input.options?.length) {
      at('options', 'Only select Fields have options.')
    }
    if (input.archived) def.archived = true
    fields.push(canonField(def))
  })
  return { fields, problems }
}

/**
 * Checks the new Fields against the current ones (4.5, 4.6). Allowed: new Fields, new labels, help, required,
 * archive and restore, new options, archived options. Refused: another data type, a missing Field, a missing option.
 */
function checkFieldChanges(current: readonly FieldDef[], next: readonly FieldDef[]): Problem[] {
  const problems: Problem[] = []
  const nextIndex = new Map(next.map((f, i) => [f.key, i]))
  for (const cur of current) {
    const i = nextIndex.get(cur.key)
    if (i === undefined) {
      problems.push({ key: 'fields', reason: `The Field “${cur.label}” (${cur.key}) cannot be deleted, because old tickets use it. Archive it instead.` })
      continue
    }
    const f = next[i]!
    if (f.type !== cur.type) {
      problems.push({ key: `fields.${i}.type`, reason: `The data type of “${cur.label}” (${cur.key}) cannot change from ${cur.type}. Archive the Field and add a new one.` })
      continue
    }
    const kept = new Set((f.options ?? []).map(o => o.value))
    for (const o of cur.options ?? []) {
      if (!kept.has(o.value)) problems.push({ key: `fields.${i}.options`, reason: `The option “${o.value}” of “${cur.label}” cannot be removed, because old tickets use it. Archive it instead.` })
    }
  }
  return problems
}

async function teamExists(db: Db, id: number) {
  const [row] = await db.select({ id: team.id }).from(team).where(eq(team.id, id)).limit(1)
  return row !== undefined
}

/** Name and prefix must be unique across all types. Archived prefixes stay reserved (4.9b). */
async function uniquenessProblems(db: Db, name: string | undefined, prefix: string | undefined, exceptId: number | null): Promise<Problem[]> {
  const matches = [
    name === undefined ? undefined : sql`lower(${ticketType.name}) = ${name.toLowerCase()}`,
    prefix === undefined ? undefined : eq(ticketType.prefix, prefix),
  ].filter(m => m !== undefined)
  if (matches.length === 0) return []
  const rows = await db.select({ id: ticketType.id, name: ticketType.name, prefix: ticketType.prefix, archivedAt: ticketType.archivedAt })
    .from(ticketType).where(or(...matches))
  const problems: Problem[] = []
  for (const row of rows) {
    if (row.id === exceptId) continue
    if (name !== undefined && row.name.toLowerCase() === name.toLowerCase()) {
      problems.push(row.archivedAt
        ? { key: 'name', reason: 'An archived type has this name. Restore it from the list instead.', restore_type_id: row.id }
        : { key: 'name', reason: 'A ticket type with this name exists.' })
    }
    if (prefix !== undefined && row.prefix === prefix) {
      problems.push({ key: 'prefix', reason: row.archivedAt ? `${prefix} is used by ${row.name}, which is archived. An archived prefix stays reserved.` : `${prefix} is used by ${row.name}.` })
    }
  }
  if (prefix !== undefined) {
    const [old] = await db.select({ ownerId: ticketTypeOldPrefix.ticketTypeId }).from(ticketTypeOldPrefix).where(eq(ticketTypeOldPrefix.prefix, prefix)).limit(1)
    // A type may take back its own earlier prefix.
    if (old && old.ownerId !== exceptId) problems.push({ key: 'prefix', reason: `${prefix} was used by another type before. A replaced prefix stays reserved, so old references stay clear.` })
  }
  return problems
}

/** A unique-index failure in a batch means that another save won the race. */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error as { message?: string, cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    if (/UNIQUE constraint failed/i.test(e.message ?? '')) return true
  }
  return false
}

function conflict(): TypeAdminError {
  return new TypeAdminError(409, 'CONFLICT', 'Another change was saved at the same time. Reload the page and try again.')
}

type VersionRow = { ticketTypeId: number, version: number, fields: FieldDef[] }

function toRow(view: TicketTypeView, archivedAt: Date | null, version: VersionRow | undefined, tickets: { total: number, open: number } | undefined): AdminTypeRow {
  if (!version) throw new Error(`Ticket Type ${view.prefix} has no Schema Version. Creating a type must make version 1 (4.15a).`)
  return {
    ...view,
    archived_at: archivedAt?.toISOString() ?? null,
    schema_version: version.version,
    field_count: version.fields.filter(f => !f.archived).length,
    open_tickets: tickets?.open ?? 0,
    ticket_count: tickets?.total ?? 0,
  }
}

function ticketCounts(db: Db) {
  return db.select({
    typeId: ticket.ticketTypeId,
    total: count(),
    open: sql<number>`coalesce(sum(case when ${status.category} != 'done' then 1 else 0 end), 0)`,
  }).from(ticket).leftJoin(status, eq(ticket.status, status.key)).groupBy(ticket.ticketTypeId)
}

/** Every type, archived ones too, and the Teams for the "Owning team" select. Three queries, whatever the number of types. */
export async function listAdminTypes(db: Db): Promise<{ types: AdminTypeRow[], teams: AdminTeam[] }> {
  const [rows, versions, counts, teams] = await Promise.all([
    selectTypes(db).orderBy(asc(ticketType.id)),
    // The newest version of each type.
    db.select().from(schemaVersion).where(sql`${schemaVersion.version} = (select max(v.version) from schema_version v where v.ticket_type_id = ${schemaVersion.ticketTypeId})`),
    ticketCounts(db),
    db.select({ id: team.id, name: team.name }).from(team).orderBy(asc(team.name)),
  ])
  const versionOf = new Map(versions.map(v => [v.ticketTypeId, v]))
  const countOf = new Map(counts.map(c => [c.typeId, c]))
  return {
    types: rows.map(r => toRow(toView(r), r.archivedAt, versionOf.get(r.id), countOf.get(r.id))),
    teams,
  }
}

export async function getAdminType(db: Db, id: number): Promise<AdminTypeDetail | null> {
  const [row] = await selectTypes(db).where(eq(ticketType.id, id)).limit(1)
  if (!row) return null
  const [version, [counts]] = await Promise.all([
    currentSchemaVersion(db, id),
    ticketCounts(db).where(eq(ticket.ticketTypeId, id)),
  ])
  return { ...toRow(toView(row), row.archivedAt, version, counts), fields: version.fields }
}

/** Creates a type and its Schema Version 1 together. Nothing is saved when anything is invalid (4.15a). */
export async function createTicketType(db: Db, input: unknown): Promise<AdminTypeDetail> {
  const parsed = createInput.safeParse(input)
  if (!parsed.success) throw invalid(toProblems(parsed.error.issues))
  const data = parsed.data
  const problems: Problem[] = []

  const prefix = data.prefix ?? suggestPrefix(data.name)
  if (!PREFIX_PATTERN.test(prefix)) problems.push({ key: 'prefix', reason: 'Use 2 to 5 letters.' })
  const built = buildFields(data.fields ?? [])
  problems.push(...built.problems)

  const [colors, firstTeam] = await Promise.all([
    db.select({ color: ticketType.color }).from(ticketType),
    db.select({ id: team.id }).from(team).orderBy(asc(team.id)).limit(1),
  ])
  const teamId = data.team_id ?? firstTeam[0]?.id
  if (teamId === undefined) problems.push({ key: 'team_id', reason: 'Create a Team first.' })
  else if (data.team_id !== undefined && !(await teamExists(db, teamId))) problems.push({ key: 'team_id', reason: 'No Team has this ID.' })
  if (PREFIX_PATTERN.test(prefix)) problems.push(...await uniquenessProblems(db, data.name, prefix, null))
  else problems.push(...await uniquenessProblems(db, data.name, undefined, null))
  if (problems.length || teamId === undefined) throw invalid(problems)

  try {
    const [[created]] = await db.batch([
      db.insert(ticketType).values({
        name: data.name,
        prefix,
        description: data.description,
        icon: data.icon ?? suggestIcon(data.name),
        color: (data.color ?? firstUnusedColor(colors.map(c => c.color))).toUpperCase(),
        teamId,
        visibleToAll: data.visible_to_all ?? false,
      }).returning({ id: ticketType.id }),
      // Same batch, so a type never exists without version 1.
      db.insert(schemaVersion).values({ ticketTypeId: sql`(select id from ticket_type where prefix = ${prefix})`, version: 1, fields: built.fields }),
    ])
    return (await getAdminType(db, created!.id))!
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict()
    throw error
  }
}

/**
 * Changes the settings of a type and/or its Fields. A change to the Fields adds a Schema Version and updates
 * no earlier one (4.4). `fields` is the full list: every earlier Field stays in it.
 */
export async function updateTicketType(db: Db, id: number, input: unknown): Promise<AdminTypeDetail> {
  const parsed = updateInput.safeParse(input)
  if (!parsed.success) throw invalid(toProblems(parsed.error.issues))
  const data = parsed.data
  if (Object.keys(data).length === 0) throw invalid([{ key: 'body', reason: 'Send at least one change.' }])

  const current = await getAdminType(db, id)
  if (!current) throw new TypeAdminError(404, 'NOT_FOUND', 'No Ticket Type has this ID.')
  const problems: Problem[] = []

  const set: Partial<typeof ticketType.$inferInsert> = {}
  if (data.name !== undefined && data.name !== current.name) set.name = data.name
  if (data.prefix !== undefined && data.prefix !== current.prefix) set.prefix = data.prefix
  if (data.description !== undefined && data.description !== current.description) set.description = data.description
  if (data.icon !== undefined && data.icon !== current.icon) set.icon = data.icon
  if (data.color !== undefined && data.color.toUpperCase() !== current.color.toUpperCase()) set.color = data.color.toUpperCase()
  if (data.visible_to_all !== undefined && data.visible_to_all !== current.visible_to_all) set.visibleToAll = data.visible_to_all
  if (data.team_id !== undefined && data.team_id !== current.team.id) {
    if (await teamExists(db, data.team_id)) set.teamId = data.team_id
    else problems.push({ key: 'team_id', reason: 'No Team has this ID.' })
  }
  if (data.archived !== undefined && data.archived !== (current.archived_at !== null)) set.archivedAt = data.archived ? new Date() : null
  problems.push(...await uniquenessProblems(db, set.name, set.prefix, id))

  let nextFields: FieldDef[] | null = null
  if (data.fields !== undefined) {
    if (data.base_version === undefined) {
      problems.push({ key: 'base_version', reason: `Send the version you edited (schema_version ${current.schema_version}).` })
    } else if (data.base_version !== current.schema_version) {
      throw new TypeAdminError(409, 'CONFLICT', `This type changed since you opened it. It is now version ${current.schema_version}. Reload the page and apply your change again.`)
    }
    const built = buildFields(data.fields)
    problems.push(...built.problems)
    if (built.problems.length === 0) {
      problems.push(...checkFieldChanges(current.fields, built.fields))
      if (JSON.stringify(built.fields) !== JSON.stringify(current.fields.map(canonField))) nextFields = built.fields
    }
  }
  if (problems.length) throw invalid(problems)

  const writes = []
  if (Object.keys(set).length) writes.push(db.update(ticketType).set(set).where(eq(ticketType.id, id)))
  if (set.prefix) writes.push(db.insert(ticketTypeOldPrefix).values({ prefix: current.prefix, ticketTypeId: id }).onConflictDoNothing())
  // The unique index on (type, version) refuses a second save of the same version.
  if (nextFields) writes.push(db.insert(schemaVersion).values({ ticketTypeId: id, version: current.schema_version + 1, fields: nextFields }))
  if (writes.length === 0) return current
  try {
    await db.batch(writes as [typeof writes[0], ...typeof writes])
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict()
    throw error
  }
  return (await getAdminType(db, id))!
}
