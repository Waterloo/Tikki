/**
 * The Field validator (PRD module 3). Pure: no I/O, no `eval`, so it runs on Workers and in plain unit tests.
 * Validation uses our own Field definitions, never a JSON Schema library (4.16).
 */

export const FIELD_TYPES = ['short_text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'checkbox', 'user', 'url', 'file'] as const
export type FieldType = typeof FIELD_TYPES[number]

export interface FieldOption {
  value: string
  archived?: boolean
}

/** One Field of a Schema Version. `key` and `type` never change across versions (4.5). */
export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required: boolean
  help: string
  /** Only for `single_select` and `multi_select`. */
  options?: FieldOption[]
  archived?: boolean
}

export type FieldValues = Record<string, unknown>

/** One problem, with what a person or Claude needs to fix it (5.10). */
export interface FieldError {
  key: string
  label: string
  reason: string
  /** The allowed values, for select Fields. */
  options?: string[]
}

export type FieldResult = { ok: true, values: FieldValues } | { ok: false, errors: FieldError[] }

const MAX_SHORT_TEXT = 500
const MAX_LONG_TEXT = 20_000
const MAX_URL = 2000

export function activeOptions(field: FieldDef): string[] {
  return (field.options ?? []).filter(o => !o.archived).map(o => o.value)
}

function isEmpty(value: unknown) {
  return value === undefined || value === null
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0)
}

function isDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

type Check = { value: unknown } | { reason: string }

function text(value: unknown, max: number): Check {
  if (typeof value !== 'string') return { reason: 'Must be text.' }
  const trimmed = value.trim()
  return trimmed.length > max ? { reason: `Must be ${max} characters or fewer.` } : { value: trimmed }
}

function checkValue(field: FieldDef, value: unknown): Check {
  switch (field.type) {
    case 'short_text':
      return text(value, MAX_SHORT_TEXT)
    case 'long_text':
      return text(value, MAX_LONG_TEXT)
    case 'number': {
      // Forms and AI clients often send numbers as text, so a string that is exactly a number is accepted.
      const n = typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value
      return typeof n === 'number' && Number.isFinite(n) ? { value: n } : { reason: 'Must be a number.' }
    }
    case 'date':
      return typeof value === 'string' && isDate(value.trim()) ? { value: value.trim() } : { reason: 'Must be a date in the format YYYY-MM-DD.' }
    case 'single_select':
      return typeof value === 'string' && activeOptions(field).includes(value) ? { value } : { reason: 'Must be one of the options.' }
    case 'multi_select': {
      const list = typeof value === 'string' ? [value] : value
      if (!Array.isArray(list) || !list.every(v => typeof v === 'string' && activeOptions(field).includes(v))) {
        return { reason: 'Must be a list of values from the options.' }
      }
      return { value: [...new Set(list)] }
    }
    case 'checkbox':
      if (typeof value !== 'boolean') return { reason: 'Must be true or false.' }
      // A required checkbox is a confirmation, so only `true` satisfies it.
      return field.required && !value ? { reason: 'Required.' } : { value }
    case 'user':
      return typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? { value } : { reason: 'Must be a User ID.' }
    case 'url': {
      if (typeof value !== 'string' || value.trim().length > MAX_URL || !URL.canParse(value.trim())) return { reason: 'Must be a full URL that starts with https:// or http://.' }
      const url = new URL(value.trim())
      // Other schemes (javascript:, data:) become links in the UI.
      return url.protocol === 'https:' || url.protocol === 'http:' ? { value: url.href } : { reason: 'Must be a full URL that starts with https:// or http://.' }
    }
    case 'file':
      return typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? { value } : { reason: 'Must be a file reference.' }
  }
}

/**
 * Checks submitted values against the Fields of one Schema Version, for a new ticket.
 * Returns the normalized values (trimmed, empty values left out), or every problem at once.
 */
export function validateFields(fields: readonly FieldDef[], input: FieldValues): FieldResult {
  const errors: FieldError[] = []
  const values: FieldValues = {}
  const byKey = new Map(fields.map(f => [f.key, f]))

  for (const key of Object.keys(input)) {
    const field = byKey.get(key)
    if (!field) {
      const known = fields.filter(f => !f.archived).map(f => f.key)
      errors.push({ key, label: key, reason: `This Ticket Type has no Field with this key. Known keys: ${known.join(', ') || 'none'}.` })
    } else if (field.archived && !isEmpty(input[key])) {
      errors.push({ key, label: field.label, reason: 'This Field is archived and takes no new values.' })
    }
  }

  for (const field of fields) {
    if (field.archived) continue
    const value = input[field.key]
    const problem = (reason: string) => {
      const error: FieldError = { key: field.key, label: field.label, reason }
      if (field.type === 'single_select' || field.type === 'multi_select') error.options = activeOptions(field)
      errors.push(error)
    }
    if (isEmpty(value)) {
      if (field.required) problem('Required.')
      continue
    }
    const check = checkValue(field, value)
    if ('reason' in check) problem(check.reason)
    else values[field.key] = check.value
  }

  return errors.length ? { ok: false, errors } : { ok: true, values }
}
