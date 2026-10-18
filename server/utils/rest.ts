import { getRouterParam, readRawBody, type H3Event } from 'h3'
import { ApplicationInputError, principalForKey } from './applications'
import type { Role } from './auth'
import { db, useAuth } from './services'
import { RevertRefusal } from './activity'
import { limitMessage, takeSlot, takeToolSlot, USER_WEB_LIMIT, type Limited } from './rate-limit'
import { PeopleError } from './people'
import { authorizeManagePeople, isAdmin, isTicketAppRoute, NOT_FOUND, PolicyRefusal } from './policy'
import { looksLikeJwt, principalForContextToken, TicketAppError } from './ticket-apps'
import { TypeAdminError } from './ticket-type-admin'
import { IdempotencyMismatch, parseTicketReference, TicketValidationError, type Principal, type UserPrincipal } from './tickets'

/** The one error format of the REST API (6.4). */
export function apiError(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, details: details ?? null } }, { status })
}

/** 429 with `Retry-After`, in the standard error format. */
export function rateLimited(what: string, limited: Limited): Response {
  const res = apiError(429, 'RATE_LIMITED', limitMessage(what, limited))
  res.headers.set('retry-after', String(limited.retryAfter))
  return res
}

/** The WebMCP tools in the page send it (issue 36). It is a label: the rights stay those of the User (5.1). */
const CHANNEL_HEADER = 'x-tikki-channel'

/** The User of the web session. For routes that an Application must never use. */
export async function sessionPrincipal(event: H3Event): Promise<UserPrincipal | Response> {
  const channel = event.headers.get(CHANNEL_HEADER)
  if (channel !== null && channel !== 'ai') return apiError(400, 'INVALID_CHANNEL', 'X-Tikki-Channel must be "ai".')
  const session = await useAuth().api.getSession({ headers: event.headers })
  if (!session) return apiError(401, 'UNAUTHENTICATED', 'Sign in first.')
  const userId = session.user.id
  // The MCP limits, counted per request. The upload routes pass no method, so an upload counts as a write.
  const limited = channel === 'ai'
    ? await takeToolSlot(db, userId, event.method !== 'GET' && event.method !== 'HEAD')
    : await takeSlot(db, `user:${userId}`, USER_WEB_LIMIT)
  if (limited) return rateLimited(channel === 'ai' ? 'tool calls' : 'requests', limited)
  return { kind: 'user', userId, role: session.user.role as Role, channel: channel === 'ai' ? 'ai' : 'web' }
}

/**
 * The Principal for a REST request: an Application with `Authorization: Bearer gt_live_...`, a User through a Ticket
 * App with `Authorization: Bearer <context token>`, else the web session. A request with an Authorization header is
 * never read as a session, so a bad key cannot fall back to a cookie.
 */
export async function restPrincipal(event: H3Event): Promise<Principal | Response> {
  // `event.headers`, not getHeader: the upload routes pass only the headers (server/utils/upload.ts).
  const authorization = event.headers.get('authorization')
  if (authorization === null) return sessionPrincipal(event)
  // An API key or a context token has its own channel. A wrong client must fail visibly.
  if (event.headers.has(CHANNEL_HEADER)) return apiError(400, 'INVALID_CHANNEL', 'X-Tikki-Channel is only for requests with the web session.')
  const key = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1]
  if (key && looksLikeJwt(key)) return contextTokenPrincipal(event, key)
  const check = key ? await principalForKey(db, key) : { ok: false as const, reason: 'invalid' as const }
  if (check.ok) {
    const { applicationId } = check.principal
    // A create counts in both limits, so the create limit is checked first and cannot be used up by refused calls.
    const isCreate = event.method === 'POST' && event.path.split('?')[0] === '/api/v1/tickets'
    const limited = (isCreate ? await takeSlot(db, `app-create:${applicationId}`, check.limits.creates) : null)
      ?? await takeSlot(db, `app:${applicationId}`, check.limits.requests)
    if (limited) return rateLimited('requests', limited)
    return check.principal
  }
  if (check.reason === 'disabled') return apiError(403, 'APPLICATION_DISABLED', 'This Application is disabled. An Admin can enable it again.')
  return apiError(401, 'UNAUTHENTICATED', 'The API key is not valid. It may be revoked. Send it as "Authorization: Bearer gt_live_...".')
}

async function contextTokenPrincipal(event: H3Event, token: string): Promise<UserPrincipal | Response> {
  const principal = await principalForContextToken(db, token)
  if (!principal) return apiError(401, 'UNAUTHENTICATED', 'The context token is not valid. It may be expired, or its Ticket App is off or deleted. Ask Tikki for a new one with tikki:fetch-context.')
  // The upload routes pass no method or path, so they are refused too.
  if (!isTicketAppRoute(event.method ?? '', (event.path ?? '').split('?')[0]!)) {
    return apiError(403, 'FORBIDDEN', 'A context token can use only the ticket, comment and activity routes of its own ticket.')
  }
  // The Agent's own web limit: an app cannot do more than the Agent could by hand.
  const limited = await takeSlot(db, `user:${principal.userId}`, USER_WEB_LIMIT)
  if (limited) return rateLimited('requests', limited)
  return principal
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
  if (error instanceof RevertRefusal) return apiError(409, error.code, error.message)
  if (error instanceof IdempotencyMismatch) return apiError(409, 'IDEMPOTENCY_KEY_REUSED', error.message)
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

/** The Principal for the People and Teams routes. The permission rule is in the policy module. */
export async function peoplePrincipal(event: H3Event): Promise<UserPrincipal | Response> {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const refusal = authorizeManagePeople(principal)
  if (refusal) return apiError(refusal.status, refusal.code, refusal.message)
  if (principal.kind !== 'user') throw new Error('The policy let an Application manage people.')
  return principal
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

/** Maps the errors of the Ticket Apps module to responses. Anything else is a bug and goes on as a 500. */
export function ticketAppError(error: unknown): Response {
  if (error instanceof TicketAppError) return apiError(error.status, error.code, error.message, error.details)
  if (error instanceof PolicyRefusal) return apiError(error.refusal.status, error.refusal.code, error.refusal.message)
  throw error
}
