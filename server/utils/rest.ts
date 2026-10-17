import { getHeader, getRouterParam, readRawBody, type H3Event } from 'h3'
import { ApplicationInputError, principalForKey } from './applications'
import type { Role } from './auth'
import { db, useAuth } from './services'
import { isAdmin, NOT_FOUND, PolicyRefusal } from './policy'
import { IdempotencyMismatch, parseTicketReference, TicketValidationError, type Principal, type UserPrincipal } from './tickets'

/** The one error format of the REST API (6.4). */
export function apiError(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, details: details ?? null } }, { status })
}

/** The User of the web session. For routes that an Application must never use. */
export async function sessionPrincipal(event: H3Event): Promise<UserPrincipal | Response> {
  const session = await useAuth().api.getSession({ headers: event.headers })
  if (!session) return apiError(401, 'UNAUTHENTICATED', 'Sign in first.')
  return { kind: 'user', userId: session.user.id, role: session.user.role as Role, channel: 'web' }
}

/**
 * The Principal for a REST request: an Application with `Authorization: Bearer gt_live_...`, else the web session.
 * A request with an Authorization header is never read as a session, so a bad key cannot fall back to a cookie.
 */
export async function restPrincipal(event: H3Event): Promise<Principal | Response> {
  const authorization = getHeader(event, 'authorization')
  if (authorization === undefined) return sessionPrincipal(event)
  const key = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1]
  const check = key ? await principalForKey(db, key) : { ok: false as const, reason: 'invalid' as const }
  if (check.ok) return check.principal
  if (check.reason === 'disabled') return apiError(403, 'APPLICATION_DISABLED', 'This Application is disabled. An Admin can enable it again.')
  return apiError(401, 'UNAUTHENTICATED', 'The API key is not valid. It may be revoked. Send it as "Authorization: Bearer gt_live_...".')
}

/** Like an Admin check, but for the REST routes that are only for Admins (12.3a). An API key is never an Admin. */
export async function adminPrincipal(event: H3Event): Promise<UserPrincipal | Response> {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  if (!isAdmin(principal)) return apiError(403, 'FORBIDDEN', 'Only Admins can do this.')
  return principal
}

/** The JSON body and its raw text, or the error response for a body that is not JSON. */
export async function readJson(event: H3Event): Promise<{ value: unknown, raw: string } | Response> {
  const raw = (await readRawBody(event, 'utf8')) ?? ''
  try {
    return { value: raw === '' ? undefined : JSON.parse(raw), raw }
  } catch {
    return apiError(400, 'INVALID_JSON', 'The request body is not valid JSON.')
  }
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
  if (error instanceof IdempotencyMismatch) return apiError(409, 'IDEMPOTENCY_KEY_REUSED', error.message)
  throw error
}

/** The ticket number in the route, or the same refusal as for a ticket that does not exist. */
export function routeTicketNumber(event: H3Event): number {
  const number = parseTicketReference(getRouterParam(event, 'ref') ?? '')
  if (number === null) throw new PolicyRefusal(NOT_FOUND)
  return number
}

/** A positive integer ID in the route, or null. */
export function routeId(event: H3Event, name: string): number | null {
  const value = getRouterParam(event, name) ?? ''
  return /^[1-9]\d{0,15}$/.test(value) ? Number(value) : null
}

export function applicationNotFound(): Response {
  return apiError(404, 'NOT_FOUND', 'No Application has this ID.')
}

export function applicationError(error: unknown): Response {
  if (error instanceof ApplicationInputError) return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', error.details)
  throw error
}
