import { and, eq, isNull, or, type SQL } from 'drizzle-orm'
import { contact, ticket, ticketType, type ApplicationPermission, type StatusCategory } from '../db/schema'
import type { ApplicationPrincipal, Principal, UserPrincipal } from './tickets'

/**
 * The one place that answers "may Principal P do action A on ticket T?" (PRD module 1).
 * REST, MCP, and the UI (through `allowed_actions`) use it. No other code checks permissions.
 */

export const TICKET_ACTIONS = ['read', 'change_status', 'change_priority', 'assign', 'edit_fields', 'edit_description', 'change_type', 'comment', 'comment_internal', 'cancel', 'reopen', 'delete'] as const
export type TicketAction = typeof TICKET_ACTIONS[number]

/** The facts about a ticket that the rules use. */
export interface PolicyTicket {
  /** The User who is the Requester, or null when the Requester is a Contact. */
  requesterId: string | null
  /** The Application whose Contact is the Requester, or null. This is the Application that created the ticket. */
  applicationId: number | null
  visibleToAll: boolean
  statusKey: string
  statusCategory: StatusCategory
  /** Soft-deleted by an Admin (issue 22). Nobody can read it; only an Admin can restore it. */
  deleted: boolean
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
  change_type: 'Only Agents can change the Ticket Type of a ticket.',
  comment: 'You cannot comment on this ticket.',
  comment_internal: 'Only Agents can write Internal Comments.',
  delete: 'Only Admins can delete a ticket.',
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
  // A deleted ticket is hidden from every channel, Admins included; they see it only in the deleted list.
  if (t.deleted) return false
  // An Application sees only the tickets it created (3.11), and "visible to all" is for internal Users only.
  if (principal.kind === 'application') return t.applicationId === principal.applicationId
  // "Visible to all" is for internal tickets. A Contact's ticket holds customer data, so only staff see it.
  return isStaff(principal) || t.requesterId === principal.userId || (t.visibleToAll && t.applicationId === null)
}

/** Null when the Principal may do the action; otherwise the refusal. */
export function authorize(principal: Principal, action: TicketAction, t: PolicyTicket): Refusal | null {
  if (!canRead(principal, t)) return NOT_FOUND
  const forbidden = (message: string): Refusal => ({ status: 403, code: 'FORBIDDEN', message })
  if (principal.kind === 'application') {
    // Every action needs `tickets:read`, because each one answers with the ticket or the comment.
    if (!has(principal, 'tickets:read')) return missing('tickets:read')
    if (action === 'comment' || action === 'comment_internal') return authorizeApplicationComment(principal, t, action === 'comment_internal')
    if (action === 'read') return null
    // The only other actions are cancel and reopen, for the Contact it acts for, with the User rules below.
    if (action !== 'cancel' && action !== 'reopen') return forbidden(AGENT_ONLY[action])
    if (!has(principal, 'tickets:update')) return missing('tickets:update')
  }
  // Everyone who can read a ticket can write a Public Comment (4.18).
  if (action === 'read' || action === 'comment') return null
  // An Application that can read the ticket acts for its Contact, who is the Requester. A Contact's ticket has no
  // User Requester; the null check keeps it from matching.
  const isRequester = principal.kind === 'application' || (t.requesterId !== null && t.requesterId === principal.userId)
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
    case 'delete':
      return isAdmin(principal) ? null : forbidden(AGENT_ONLY.delete)
    default:
      return isStaff(principal) ? null : forbidden(AGENT_ONLY[action])
  }
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
 * It always excludes deleted tickets.
 */
export function readableTickets(principal: Principal): SQL {
  const visible = isNull(ticket.deletedAt)
  if (principal.kind === 'application') return and(visible, eq(contact.applicationId, principal.applicationId))!
  if (isStaff(principal)) return visible
  return and(visible, or(eq(ticket.requesterId, principal.userId), and(eq(ticketType.visibleToAll, true), isNull(ticket.contactId))))!
}

/** Restoring and listing deleted tickets is for Admins. Anyone else gets NOT_FOUND: for them the ticket does not exist. */
export function authorizeRestore(principal: Principal): Refusal | null {
  return isAdmin(principal) ? null : NOT_FOUND
}

export const NO_CONTACT: Refusal = { status: 404, code: 'NOT_FOUND', message: 'No Contact with this ID.' }

/**
 * Erasure of a Contact (9.2): an Admin, or the Application that owns the Contact. Another Application gets NOT_FOUND,
 * so it cannot probe for Contacts. No permission is needed: a data request is the owning Application's right.
 */
export function authorizeErasure(principal: Principal, contactApplicationId: number): Refusal | null {
  if (principal.kind === 'application') return principal.applicationId === contactApplicationId ? null : NO_CONTACT
  return isAdmin(principal) ? null : { status: 403, code: 'FORBIDDEN', message: 'Only Admins can erase personal data.' }
}

// Attachments (issue 16). A file is as visible as its ticket (7.1).
export const NO_ATTACHMENT: Refusal = { status: 404, code: 'NOT_FOUND', message: 'No attachment with this ID.' }

/** Adding a file to a ticket takes the right to read the ticket. An Application can read only its own tickets. */
export function authorizeAttach(principal: Principal, t: PolicyTicket): Refusal | null {
  return canRead(principal, t) ? null : NOT_FOUND
}

/** Only a User can upload before the ticket exists: an Application's create takes no file IDs. */
export function authorizeUnattachedUpload(principal: Principal): Refusal | null {
  return principal.kind === 'user' ? null : { status: 403, code: 'FORBIDDEN', message: 'An Application can add files only to its own tickets.' }
}

/** An upload made before its ticket exists (`ticket` is null) belongs to its uploader alone. */
export function authorizeAttachmentRead(principal: Principal, a: { uploaderId: string | null, ticket: PolicyTicket | null }): Refusal | null {
  if (a.ticket === null) return principal.kind === 'user' && a.uploaderId === principal.userId ? null : NO_ATTACHMENT
  return canRead(principal, a.ticket) ? null : NO_ATTACHMENT
}

/** People and Teams: only Admins manage them (issue 20). */
export function authorizeManagePeople(principal: Principal): Refusal | null {
  if (isAdmin(principal)) return null
  return { status: 403, code: 'FORBIDDEN', message: 'Only Admins can manage people and Teams.' }
}

export function assertCanManagePeople(principal: Principal): asserts principal is UserPrincipal {
  const refusal = authorizeManagePeople(principal)
  if (refusal) throw new PolicyRefusal(refusal)
}

/** An Admin cannot lock themself out. The last-Admin rule needs the database, so it is in `people.ts`. */
export function assertCanDeactivate(principal: Principal, targetId: string): void {
  assertCanManagePeople(principal)
  if (principal.userId === targetId) {
    throw new PolicyRefusal({ status: 403, code: 'FORBIDDEN', message: 'You cannot deactivate yourself. Ask another Admin.' })
  }
}

/** A Team member must be an Agent or an Admin, because a Team is a group of Agents. */
export function canJoinTeam(role: string) {
  return STAFF_ROLES.includes(role)
}
