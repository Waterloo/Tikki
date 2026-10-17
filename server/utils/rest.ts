import type { H3Event } from 'h3'
import type { Role } from './auth'
import { useAuth } from './services'
import { TicketValidationError, type Principal } from './tickets'

/** The one error format of the REST API (6.4). */
export function apiError(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, details: details ?? null } }, { status })
}

/** The Principal for a REST request, from the web session. API keys come in issue 12. */
export async function restPrincipal(event: H3Event): Promise<Principal | Response> {
  const session = await useAuth().api.getSession({ headers: event.headers })
  if (!session) return apiError(401, 'UNAUTHENTICATED', 'Sign in first.')
  return { userId: session.user.id, role: session.user.role as Role, channel: 'web' }
}

/** Like an Admin check, but for the REST routes that are only for Admins (12.3a). */
export async function adminPrincipal(event: H3Event): Promise<Principal | Response> {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  if (principal.role !== 'admin') return apiError(403, 'FORBIDDEN', 'Only Admins can do this.')
  return principal
}

export function validationFailed(issues: { path: PropertyKey[], message: string }[]): Response {
  const details = issues.map(i => ({ key: String(i.path[0] ?? 'body'), reason: i.message }))
  return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', details)
}

export function validationError(error: TicketValidationError): Response {
  return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', error.details)
}
