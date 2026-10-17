export interface ApiProblem {
  status?: number
  code?: string
  message: string
  details: { key: string, reason: string }[]
}

/** The error format of the REST API (6.4), from a failed `$fetch`. */
export function apiProblem(e: unknown): ApiProblem {
  const data = (e as { data?: { error?: { code?: string, message?: string, details?: { key: string, reason: string }[] | null } } }).data?.error
  return {
    status: (e as { status?: number }).status,
    code: data?.code,
    message: data?.message ?? 'Something went wrong. Try again.',
    details: data?.details ?? [],
  }
}
