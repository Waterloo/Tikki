import type { AdminType, Problem } from '~/types/ticket-types'

/** Checks while the Admin types. The server checks again and decides. */
export function nameProblem(name: string, types: readonly AdminType[], exceptId?: number): Problem | null {
  const lower = name.trim().toLowerCase()
  const other = lower ? types.find(t => t.id !== exceptId && t.name.toLowerCase() === lower) : undefined
  if (!other) return null
  return other.archived_at
    ? { key: 'name', reason: 'An archived type has this name.', restore_type_id: other.id }
    : { key: 'name', reason: 'A ticket type with this name exists.' }
}

export function prefixProblem(prefix: string, types: readonly AdminType[], exceptId?: number): Problem | null {
  if (prefix.length < 2) return { key: 'prefix', reason: 'Use 2 to 5 letters.' }
  const other = types.find(t => t.id !== exceptId && t.prefix === prefix)
  if (!other) return null
  return { key: 'prefix', reason: other.archived_at ? `${prefix} is used by ${other.name}, which is archived. An archived prefix stays reserved.` : `${prefix} is used by ${other.name}.` }
}

export interface ApiFailure {
  status?: number
  message: string
  problems: Problem[]
}

export function apiFailure(e: unknown): ApiFailure {
  const err = e as { status?: number, data?: { error?: { message?: string, details?: Problem[] | null } } }
  return { status: err.status, message: err.data?.error?.message ?? 'Something went wrong. Try again.', problems: err.data?.error?.details ?? [] }
}

/** The first problem for each input name. */
export function problemMap(problems: readonly Problem[]): Record<string, Problem> {
  const map: Record<string, Problem> = {}
  for (const p of problems) map[p.key] ??= p
  return map
}
