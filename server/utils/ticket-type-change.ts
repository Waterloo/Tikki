import { z } from 'zod'
import type { Db } from './auth'
import type { FieldDef, FieldError, FieldValues } from './fields'
import { applyChange, getTicket, loadFor, pinnedFields, TicketValidationError, type Principal, type TicketDetail } from './tickets'
import { loadTicketType } from './ticket-types'

const input = z.strictObject({
  ticket_type_id: z.number({ error: 'Choose a Ticket Type.' }).int('Choose a Ticket Type.').positive('Choose a Ticket Type.'),
}, { error: () => 'Send { ticket_type_id }.' })

/** A select value moves only if the new Field knows it. Archived options count: old values stay valid. */
function fits(to: FieldDef, value: unknown): boolean {
  if (to.type !== 'single_select' && to.type !== 'multi_select') return true
  const known = new Set((to.options ?? []).map(o => o.value))
  return (Array.isArray(value) ? value : [value]).every(v => known.has(v as string))
}

/**
 * A value moves when the new type has an active Field with the same key and data type (4.5).
 * The rest are listed with their labels, so the audit entry is readable without the old Schema Version.
 */
export function moveValues(from: readonly FieldDef[], to: readonly FieldDef[], values: FieldValues) {
  const moved: FieldValues = {}
  const unmoved: { key: string, label: string, value: unknown }[] = []
  for (const [key, value] of Object.entries(values)) {
    const source = from.find(f => f.key === key)
    const target = to.find(f => f.key === key && !f.archived)
    if (source && target && source.type === target.type && fits(target, value)) moved[key] = value
    else unmoved.push({ key, label: source?.label ?? key, value })
  }
  return { moved, unmoved }
}

/**
 * Moves the ticket to the newest Schema Version of another type. The number stays, only the prefix changes.
 * A required Field of the new type may stay empty: the ticket was made under the old rules, and Agents fill it later.
 * One audit entry holds the old and new type and the values that did not move. It cannot be reverted: the old
 * Schema Version, the Team and the dropped values may all have changed since, and Erasure can clear the values.
 */
export async function changeTicketType(db: Db, principal: Principal, number: number, body: unknown): Promise<TicketDetail> {
  const row = await loadFor(db, principal, 'change_type', number)
  const parsed = input.safeParse(body)
  if (!parsed.success) throw new TicketValidationError(parsed.error.issues.map(i => ({ key: 'ticket_type_id', label: 'Ticket Type', reason: i.message })))
  const problem = (reason: string): FieldError => ({ key: 'ticket_type_id', label: 'Ticket Type', reason })

  const target = await loadTicketType(db, parsed.data.ticket_type_id)
  if (!target) throw new TicketValidationError([problem('No Ticket Type has this ID.')])
  if (target.archived) throw new TicketValidationError([problem('This Ticket Type is archived and takes no new tickets. Choose another one.')])
  if (target.type.id === row.typeId) throw new TicketValidationError([problem('The ticket already has this Ticket Type.')])

  const { moved, unmoved } = moveValues(await pinnedFields(db, row), target.version.fields, row.fields)
  await applyChange(db, principal, number, { ticketTypeId: target.type.id, schemaVersion: target.version.version, fields: moved }, [{
    action: 'type_changed',
    before: { type: row.typeName, ref: `${row.prefix}-${number}`, unmoved },
    after: { type: target.type.name, ref: `${target.type.prefix}-${number}` },
  }])
  return getTicket(db, principal, number)
}
