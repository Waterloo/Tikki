import type { FieldType } from '~/types/ticket-types'

export const FIELD_TYPE_OPTIONS: { value: FieldType, label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'single_select', label: 'Single select' },
  { value: 'multi_select', label: 'Multi select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'user', label: 'User' },
  { value: 'url', label: 'URL' },
  { value: 'file', label: 'File' },
]

export function fieldTypeLabel(type: FieldType): string {
  return FIELD_TYPE_OPTIONS.find(o => o.value === type)?.label ?? type
}

export function isSelectType(type: FieldType): boolean {
  return type === 'single_select' || type === 'multi_select'
}

/** The Fields that the quick-add buttons add. */
export const QUICK_FIELDS: { label: string, type: FieldType, help: string, options?: string[] }[] = [
  { label: 'Branch', type: 'single_select', help: 'Your office.', options: ['Australia', 'Singapore'] },
  { label: 'Due date', type: 'date', help: 'When you need this.' },
  { label: 'Screenshot', type: 'file', help: 'A picture of the problem.' },
]
