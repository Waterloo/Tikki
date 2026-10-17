import { and, eq, isNull, or, type SQL } from 'drizzle-orm'
import { contact, ticket, ticketType, type ApplicationPermission } from '../db/schema'
import type { ApplicationPrincipal, Principal, UserPrincipal } from './tickets'

/**
 * The one place that answers "may Principal P do action A on ticket T?" (PRD module 1).
 * REST, MCP, and the UI (through `allowed_actions`) use it. No other code checks permissions.
 */

export const TICKET_ACTIONS = ['read', 'change_status', 'change_priority', 'assign'] as const
export type TicketAction = typeof TICKET_ACTIONS[number]

/** The facts about a ticket that the rules use. */
export interface PolicyTicket {
  /** The User who is the Requester, or null when the Requester is a Contact. */
  requesterId: string | null
  /** The Application whose Contact is the Requester, or null. This is the Application that created the ticket. */
  applicationId: number | null
  visibleToAll: boolean
}

/** Why an action is refused. Every channel returns these same values. */
export interface Refusal {
  status: 403 | 404
  code: 'FORBIDDEN' | 'NOT_FOUND'
  message: string
}

export class PolicyRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message)
    this.name = 'PolicyRefusal'
  }
}

// Not visible and not existing get the same refusal, so nobody can probe for other people's tickets.
export const NOT_FOUND: Refusal = { status: 404, code: 'NOT_FOUND', message: 'No ticket with this reference.' }

const AGENT_ONLY: Record<Exclude<TicketAction, 'read'>, string> = {
  change_status: 'Only Agents can change the Status of a ticket.',
  change_priority: 'Only Agents can change the Priority of a ticket.',
  assign: 'Only Agents can assign a ticket.',
}

/** Admins can do everything an Agent can (3.17). Agents see all tickets (3.5). */
const STAFF_ROLES: readonly string[] = ['admin', 'agent']

function isStaff(principal: Principal) {
  return principal.kind === 'user' && STAFF_ROLES.includes(principal.role)
}

function has(principal: ApplicationPrincipal, permission: ApplicationPermission) {
  return principal.permissions.includes(permission)
}

function missing(permission: ApplicationPermission): Refusal {
  return { status: 403, code: 'FORBIDDEN', message: `This Application does not have the ${permission} permission.` }
}

/** Only a User who works on tickets can own one. */
export function canBeAssignee(role: string) {
  return STAFF_ROLES.includes(role)
}

function canRead(principal: Principal, t: PolicyTicket) {
  // An Application sees only the tickets it created (3.11), and "visible to all" is for internal Users only.
  if (principal.kind === 'application') return t.applicationId === principal.applicationId
  // "Visible to all" is for internal tickets. A Contact's ticket holds customer data, so only staff see it.
  return isStaff(principal) || t.requesterId === principal.userId || (t.visibleToAll && t.applicationId === null)
}

/** Null when the Principal may do the action; otherwise the refusal. */
export function authorize(principal: Principal, action: TicketAction, t: PolicyTicket): Refusal | null {
  if (!canRead(principal, t)) return NOT_FOUND
  if (principal.kind === 'application' && !has(principal, 'tickets:read')) return missing('tickets:read')
  if (action === 'read' || isStaff(principal)) return null
  return { status: 403, code: 'FORBIDDEN', message: AGENT_ONLY[action] }
}

/** Null when the Principal may list tickets. Which tickets is `readableTickets`. */
export function authorizeList(principal: Principal): Refusal | null {
  return principal.kind === 'application' && !has(principal, 'tickets:read') ? missing('tickets:read') : null
}

const TYPE_NOT_ALLOWED: Refusal = { status: 403, code: 'FORBIDDEN', message: 'This Application may not create tickets of this Ticket Type.' }

/**
 * Throws PolicyRefusal when the Principal may not create a ticket, or one of this type. Every User may create.
 * An Application needs `tickets:create`, and the type must be in its allowed list (3.10).
 */
export function assertMayCreate(principal: Principal, ticketTypeId?: number): void {
  if (principal.kind === 'user') return
  if (!has(principal, 'tickets:create')) throw new PolicyRefusal(missing('tickets:create'))
  if (ticketTypeId !== undefined && !principal.ticketTypeIds.includes(ticketTypeId)) throw new PolicyRefusal(TYPE_NOT_ALLOWED)
}

/** Whether the Principal may see this Ticket Type and its Fields. An Application sees only its allowed types. */
export function canSeeTicketType(principal: Principal, ticketTypeId: number): boolean {
  return principal.kind === 'user' || principal.ticketTypeIds.includes(ticketTypeId)
}

/**
 * Internal Comments are for staff. An Application never sees them, and neither does its Contact (glossary).
 * Issue 06 (comments) filters with this, on every channel and in every payload.
 */
export function canReadInternalComments(principal: Principal): boolean {
  return isStaff(principal)
}

/**
 * Null when an Application may add a Public Comment to a ticket: it can read the ticket and has `comments:create`
 * (4.19). An Application can never add an Internal Comment. Issue 06 adds the rules for Users next to this one.
 */
export function authorizeApplicationComment(principal: ApplicationPrincipal, t: PolicyTicket, internal: boolean): Refusal | null {
  if (!canRead(principal, t)) return NOT_FOUND
  if (!has(principal, 'comments:create')) return missing('comments:create')
  if (internal) return { status: 403, code: 'FORBIDDEN', message: 'An Application can add only Public Comments.' }
  return null
}

/** Admin screens and settings are for Admins who sign in, never for an Application. */
export function isAdmin(principal: Principal): principal is UserPrincipal {
  return principal.kind === 'user' && principal.role === 'admin'
}

export function assertAllowed(principal: Principal, action: TicketAction, t: PolicyTicket): void {
  const refusal = authorize(principal, action, t)
  if (refusal) throw new PolicyRefusal(refusal)
}

/** The actions the Principal may do on the ticket, other than reading it. The UI shows only these. */
export function allowedActions(principal: Principal, t: PolicyTicket): TicketAction[] {
  return TICKET_ACTIONS.filter(a => a !== 'read' && !authorize(principal, a, t))
}

/**
 * The `read` rule as a query condition, for lists. The query must join `contact` on `ticket.contact_id`. It must match `canRead`; the REST tests check both.
 * Undefined means every ticket.
 */
export function readableTickets(principal: Principal): SQL | undefined {
  if (principal.kind === 'application') return eq(contact.applicationId, principal.applicationId)
  if (isStaff(principal)) return undefined
  return or(eq(ticket.requesterId, principal.userId), and(eq(ticketType.visibleToAll, true), isNull(ticket.contactId)))
}
