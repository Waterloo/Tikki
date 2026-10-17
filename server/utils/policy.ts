import { eq, or, type SQL } from 'drizzle-orm'
import { ticket, ticketType, type StatusCategory } from '../db/schema'
import type { Principal } from './tickets'

/**
 * The one place that answers "may Principal P do action A on ticket T?" (PRD module 1).
 * REST, MCP, and the UI (through `allowed_actions`) use it. No other code checks permissions.
 */

export const TICKET_ACTIONS = ['read', 'change_status', 'change_priority', 'assign', 'edit_fields', 'edit_description', 'comment', 'comment_internal', 'cancel', 'reopen'] as const
export type TicketAction = typeof TICKET_ACTIONS[number]

/** The facts about a ticket that the rules use. */
export interface PolicyTicket {
  requesterId: string
  visibleToAll: boolean
  statusKey: string
  statusCategory: StatusCategory
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
  edit_fields: 'Only the Requester or an Agent can edit the Fields of a ticket.',
  edit_description: 'Only the Requester or an Agent can edit the description of a ticket.',
  cancel: 'Only the Requester can cancel a ticket.',
  reopen: 'Only the Requester can reopen a ticket.',
  comment: 'You cannot comment on this ticket.',
  comment_internal: 'Only Agents can write Internal Comments.',
}

/** Admins can do everything an Agent can (3.17). Agents see all tickets (3.5). */
const STAFF_ROLES: readonly string[] = ['admin', 'agent']

function isStaff(principal: Principal) {
  return STAFF_ROLES.includes(principal.role)
}

/** Only a User who works on tickets can own one. */
export function canBeAssignee(role: string) {
  return STAFF_ROLES.includes(role)
}

function canRead(principal: Principal, t: PolicyTicket) {
  return isStaff(principal) || t.requesterId === principal.userId || t.visibleToAll
}

/** Null when the Principal may do the action; otherwise the refusal. */
export function authorize(principal: Principal, action: TicketAction, t: PolicyTicket): Refusal | null {
  if (!canRead(principal, t)) return NOT_FOUND
  // Everyone who can read a ticket can write a Public Comment (4.18).
  if (action === 'read' || action === 'comment') return null
  const forbidden = (message: string): Refusal => ({ status: 403, code: 'FORBIDDEN', message })
  const isRequester = t.requesterId === principal.userId
  switch (action) {
    // The Requester edits only while the Status Category is `open` (4.20).
    case 'edit_fields':
    case 'edit_description':
      if (isStaff(principal)) return null
      if (!isRequester) return forbidden(AGENT_ONLY[action])
      return t.statusCategory === 'open' ? null : forbidden('You can edit a ticket only while it is open. Add a comment instead.')
    // Cancel and reopen are for the Requester of the ticket only. Agents change the Status (4.21, 4.22).
    case 'cancel':
      if (!isRequester) return forbidden(AGENT_ONLY.cancel)
      return t.statusCategory === 'done' ? forbidden('A ticket that is done cannot be cancelled.') : null
    case 'reopen':
      if (!isRequester) return forbidden(AGENT_ONLY.reopen)
      return t.statusKey === 'resolved' ? null : forbidden('Only a resolved ticket can be reopened.')
    default:
      return isStaff(principal) ? null : forbidden(AGENT_ONLY[action])
  }
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
 * The `read` rule as a query condition, for lists. It must match `canRead`; the REST tests check both.
 * Undefined means every ticket.
 */
export function readableTickets(principal: Principal): SQL | undefined {
  if (isStaff(principal)) return undefined
  return or(eq(ticket.requesterId, principal.userId), eq(ticketType.visibleToAll, true))
}

/** Only Users who work on tickets see Internal Comments (4.18). Lists and counts filter with this. */
export function canSeeInternal(principal: Principal): boolean {
  return isStaff(principal)
}
