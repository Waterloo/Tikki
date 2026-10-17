import { getRouterParam, type H3Event } from 'h3'
import type { Role } from './auth'
import { useAuth } from './services'
import { RevertRefusal } from './activity'
import { PeopleError } from './people'
import { authorizeManagePeople, NOT_FOUND, PolicyRefusal } from './policy'
import { TypeAdminError } from './ticket-type-admin'
import { parseTicketReference, TicketValidationError, type Principal } from './tickets'

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

/** Maps the errors of the Tickets module to responses. Anything else is a bug and goes on as a 500. */
export function ticketError(error: unknown): Response {
  if (error instanceof PolicyRefusal) return apiError(error.refusal.status, error.refusal.code, error.refusal.message)
  if (error instanceof TicketValidationError) return validationError(error)
  if (error instanceof RevertRefusal) return apiError(409, error.code, error.message)
  throw error
}

/** The ticket number in the route, or the same refusal as for a ticket that does not exist. */
export function routeTicketNumber(event: H3Event): number {
  const number = parseTicketReference(getRouterParam(event, 'ref') ?? '')
  if (number === null) throw new PolicyRefusal(NOT_FOUND)
  return number
}

/** Maps the errors of the Ticket Type editor to responses. Anything else is a bug and goes on as a 500. */
export function typeAdminError(error: unknown): Response {
  if (error instanceof TypeAdminError) return apiError(error.status, error.code, error.message, error.details)
  throw error
}

/** The numeric ID in the route, or null. */
export function routeId(event: H3Event): number | null {
  const value = getRouterParam(event, 'id') ?? ''
  return /^[1-9]\d{0,15}$/.test(value) ? Number(value) : null
}

/** The Principal for the People and Teams routes. The permission rule is in the policy module. */
export async function peoplePrincipal(event: H3Event): Promise<Principal | Response> {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const refusal = authorizeManagePeople(principal)
  return refusal ? apiError(refusal.status, refusal.code, refusal.message) : principal
}

/** Maps the errors of the People module to responses. Anything else is a bug and goes on as a 500. */
export function peopleError(error: unknown): Response {
  if (error instanceof PolicyRefusal) return apiError(error.refusal.status, error.refusal.code, error.refusal.message)
  if (error instanceof PeopleError) return apiError(error.status, error.code, error.message, error.details)
  throw error
}

/** The positive integer in a route parameter, or the same 404 as for a row that does not exist. */
export function routeInt(event: H3Event, name: string, what: 'Team' | 'invite'): number {
  const value = Number(getRouterParam(event, name))
  if (!Number.isSafeInteger(value) || value < 1) throw new PeopleError(404, 'NOT_FOUND', `No ${what} with this id.`)
  return value
}
