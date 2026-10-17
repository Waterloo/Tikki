import { describe, expect, it } from 'vitest'
import { FIELD_TYPES, validateFields, type FieldDef, type FieldType } from '../../server/utils/fields'

function field(type: FieldType, extra: Partial<FieldDef> = {}): FieldDef {
  const options = type === 'single_select' || type === 'multi_select'
    ? [{ value: 'Singapore' }, { value: 'Australia' }, { value: 'Old office', archived: true }]
    : undefined
  return { key: 'f', label: 'The field', type, required: false, help: '', options, ...extra }
}

// [type, submitted value, normalized value]
const valid: [FieldType, unknown, unknown][] = [
  ['short_text', '  Reports  ', 'Reports'],
  ['long_text', 'line 1\nline 2', 'line 1\nline 2'],
  ['number', 42, 42],
  ['number', -1.5, -1.5],
  ['number', ' 12.5 ', 12.5],
  ['date', '2026-02-28', '2026-02-28'],
  ['date', '2028-02-29', '2028-02-29'],
  ['single_select', 'Singapore', 'Singapore'],
  ['multi_select', ['Singapore', 'Australia', 'Singapore'], ['Singapore', 'Australia']],
  ['multi_select', 'Australia', ['Australia']],
  ['checkbox', true, true],
  ['checkbox', false, false],
  ['user', 'kPz3_x-9', 'kPz3_x-9'],
  ['url', 'https://example.com/a?b=1', 'https://example.com/a?b=1'],
  ['url', 'http://example.com', 'http://example.com/'],
  ['file', 'att_123', 'att_123'],
]

// [type, submitted value, reason]
const invalid: [FieldType, unknown, string][] = [
  ['short_text', 12, 'Must be text.'],
  ['short_text', 'x'.repeat(501), 'Must be 500 characters or fewer.'],
  ['long_text', 'x'.repeat(20_001), 'Must be 20000 characters or fewer.'],
  ['long_text', ['a'], 'Must be text.'],
  ['number', '12a', 'Must be a number.'],
  ['number', Number.NaN, 'Must be a number.'],
  ['number', true, 'Must be a number.'],
  ['date', '2026-02-30', 'Must be a date in the format YYYY-MM-DD.'],
  ['date', '30/01/2026', 'Must be a date in the format YYYY-MM-DD.'],
  ['date', 20260130, 'Must be a date in the format YYYY-MM-DD.'],
  ['single_select', 'Mars', 'Must be one of the options.'],
  ['single_select', 'Old office', 'Must be one of the options.'],
  ['single_select', ['Singapore'], 'Must be one of the options.'],
  ['multi_select', ['Singapore', 'Mars'], 'Must be a list of values from the options.'],
  ['multi_select', [1], 'Must be a list of values from the options.'],
  ['checkbox', 'yes', 'Must be true or false.'],
  ['user', 'not a user id', 'Must be a User ID.'],
  ['user', 7, 'Must be a User ID.'],
  ['url', 'example.com', 'Must be a full URL that starts with https:// or http://.'],
  ['url', 'javascript:alert(1)', 'Must be a full URL that starts with https:// or http://.'],
  ['file', '../etc/passwd', 'Must be a file reference.'],
]

describe('Field validator', () => {
  it('has a table row for every data type', () => {
    expect(new Set(valid.map(([t]) => t))).toEqual(new Set(FIELD_TYPES))
    expect(new Set(invalid.map(([t]) => t))).toEqual(new Set(FIELD_TYPES))
  })

  it.each(valid)('accepts %s %j', (type, value, normalized) => {
    expect(validateFields([field(type)], { f: value })).toEqual({ ok: true, values: { f: normalized } })
  })

  it.each(invalid)('refuses %s %j', (type, value, reason) => {
    const result = validateFields([field(type)], { f: value })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual([expect.objectContaining({ key: 'f', label: 'The field', reason })])
  })

  it('gives the allowed options for select Fields, without archived options', () => {
    for (const type of ['single_select', 'multi_select'] as const) {
      const result = validateFields([field(type)], { f: 'Mars' })
      expect(result.ok ? [] : result.errors[0]!.options).toEqual(['Singapore', 'Australia'])
    }
    const text = validateFields([field('short_text')], { f: 1 })
    expect(text.ok ? null : 'options' in text.errors[0]!).toBe(false)
  })

  it.each(FIELD_TYPES)('requires a value for a required %s Field', (type) => {
    for (const empty of [undefined, null, '', '   ', []]) {
      const result = validateFields([field(type, { required: true })], empty === undefined ? {} : { f: empty })
      expect(result).toEqual({ ok: false, errors: [expect.objectContaining({ key: 'f', label: 'The field', reason: 'Required.' })] })
    }
  })

  it('needs a required checkbox to be checked', () => {
    expect(validateFields([field('checkbox', { required: true })], { f: false })).toMatchObject({ ok: false, errors: [{ reason: 'Required.' }] })
    expect(validateFields([field('checkbox', { required: true })], { f: true })).toEqual({ ok: true, values: { f: true } })
  })

  it('leaves out empty optional values', () => {
    expect(validateFields([field('short_text'), field('date', { key: 'd' })], { f: '  ', d: null })).toEqual({ ok: true, values: {} })
  })

  it('refuses unknown keys and names the known keys', () => {
    const result = validateFields([field('short_text', { key: 'page' }), field('date', { key: 'old', archived: true })], { pgae: 'Reports' })
    expect(result).toEqual({ ok: false, errors: [{ key: 'pgae', label: 'pgae', reason: 'This Ticket Type has no Field with this key. Known keys: page.' }] })
  })

  it('refuses a value for an archived Field and never requires it', () => {
    const archived = field('short_text', { required: true, archived: true })
    expect(validateFields([archived], {})).toEqual({ ok: true, values: {} })
    expect(validateFields([archived], { f: 'x' })).toMatchObject({ ok: false, errors: [{ key: 'f', reason: 'This Field is archived and takes no new values.' }] })
  })

  it('reports every problem at once', () => {
    const fields = [field('short_text', { key: 'a', label: 'A', required: true }), field('number', { key: 'b', label: 'B' }), field('single_select', { key: 'c', label: 'C' })]
    const result = validateFields(fields, { b: 'x', c: 'Mars', z: 1 })
    expect(result.ok ? [] : result.errors.map(e => e.key)).toEqual(['z', 'a', 'b', 'c'])
  })
})
