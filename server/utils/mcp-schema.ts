import type { FieldView } from './ticket-types'

type JsonSchema = Record<string, unknown>

function fieldSchema(field: FieldView): JsonSchema {
  const schema: JsonSchema = { title: field.label }
  switch (field.type) {
    case 'short_text': case 'long_text': case 'user': case 'file':
      schema.type = 'string'
      break
    case 'number':
      schema.type = 'number'
      break
    case 'date':
      schema.type = 'string'
      schema.format = 'date'
      break
    case 'url':
      schema.type = 'string'
      schema.format = 'uri'
      break
    case 'single_select':
      schema.type = 'string'
      schema.enum = field.options ?? []
      break
    case 'multi_select':
      schema.type = 'array'
      schema.items = { type: 'string', enum: field.options ?? [] }
      schema.uniqueItems = true
      break
    case 'checkbox':
      schema.type = 'boolean'
      // The validator accepts only `true` for a required checkbox.
      if (field.required) schema.const = true
      break
  }
  const notes = [field.help]
  if (field.type === 'user') notes.push('A User ID.')
  if (field.type === 'file') notes.push('A file reference.')
  schema.description = notes.filter(Boolean).join(' ')
  return schema
}

/** The Field values object of one Ticket Type as JSON Schema. Output only: validation uses the Field validator (4.16). */
export function fieldsToJsonSchema(fields: readonly FieldView[]): JsonSchema {
  const schema: JsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: Object.fromEntries(fields.map(f => [f.key, fieldSchema(f)])),
    additionalProperties: false,
  }
  const required = fields.filter(f => f.required).map(f => f.key)
  if (required.length) schema.required = required
  return schema
}
