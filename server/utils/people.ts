import { and, asc, count, eq, inArray, max, sql } from 'drizzle-orm'
import { z } from 'zod'
import { invite, oauthAccessToken, oauthRefreshToken, session, team, teamMember, ticketType, user } from '../db/schema'
import { adminAuditEntry } from './audit'
import type { Db, Role } from './auth'
import { emailDomainAllowed, type Config } from './config'
import type { MailTransport } from './mail'
import { assertCanDeactivate, assertCanManagePeople, canJoinTeam } from './policy'
import { getOrganization } from './settings'
import type { UserPrincipal } from './tickets'

/** A pending invite is valid for 30 days. An Admin can resend it, which starts the 30 days again. */
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_INVITES_AT_ONCE = 20
export const ROLES = ['admin', 'agent', 'requester'] as const

/** A refusal that is not a permission rule: a missing thing or a conflict. */
export class PeopleError extends Error {
  constructor(readonly status: 404 | 409 | 422 | 502, readonly code: string, message: string, readonly details: unknown = null) {
    super(message)
    this.name = 'PeopleError'
  }
}

const notFound = (what: 'User' | 'Team' | 'invite') => new PeopleError(404, 'NOT_FOUND', `No ${what} with this id.`)

function isUniqueViolation(error: unknown): boolean {
  for (let e = error as { message?: string, cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.message?.includes('UNIQUE constraint failed')) return true
  }
  return false
}

// ---------- Input ----------

export const userPatchInput = z.strictObject({
  role: z.enum(ROLES, { error: 'Must be admin, agent or requester.' }).optional(),
  active: z.boolean({ error: 'Must be true or false.' }).optional(),
}).refine(v => (v.role === undefined) !== (v.active === undefined), { error: 'Send either role or active, not both.', path: ['body'] })

export const inviteInput = z.strictObject({
  emails: z.array(z.string({ error: 'Must be text.' }), { error: 'Must be a list of emails.' })
    .min(1, 'Enter at least one email.')
    .max(MAX_INVITES_AT_ONCE, `Invite at most ${MAX_INVITES_AT_ONCE} people at once.`),
})

export const teamInput = z.strictObject({
  name: z.string({ error: 'Must be text.' }).trim().min(1, 'Name is required.').max(60, 'Name must be 60 characters or fewer.'),
})

// ---------- Users ----------

export type UserStatus = 'active' | 'deactivated' | 'invited' | 'expired'

export interface PersonRow {
  /** Null for an invite: the person has not signed in yet. */
  id: string | null
  invite_id: number | null
  name: string
  email: string
  role: Role
  status: UserStatus
  /** The last time a session was refreshed (about a day of precision). */
  last_active_at: string | null
  teams: { id: number, name: string }[]
}

/** Users, then pending invites. Four small queries in one round trip. */
export async function listPeople(db: Db, now = Date.now()): Promise<PersonRow[]> {
  const [users, memberships, activity, invites] = await db.batch([
    db.select({ id: user.id, name: user.name, email: user.email, role: user.role, deactivatedAt: user.deactivatedAt }).from(user).orderBy(asc(user.createdAt)),
    db.select({ userId: teamMember.userId, id: team.id, name: team.name }).from(teamMember).innerJoin(team, eq(team.id, teamMember.teamId)).orderBy(asc(team.name)),
    db.select({ userId: session.userId, at: max(session.updatedAt) }).from(session).groupBy(session.userId),
    db.select().from(invite).where(sql`${invite.acceptedAt} IS NULL`).orderBy(asc(invite.createdAt)),
  ])
  const teamsOf = Map.groupBy(memberships, m => m.userId)
  const lastActive = new Map(activity.map(a => [a.userId, a.at]))
  return [
    ...users.map((u): PersonRow => ({
      id: u.id,
      invite_id: null,
      name: u.name,
      email: u.email,
      role: u.role as Role,
      status: u.deactivatedAt ? 'deactivated' : 'active',
      last_active_at: lastActive.get(u.id) ? new Date(lastActive.get(u.id)!).toISOString() : null,
      teams: (teamsOf.get(u.id) ?? []).map(({ id, name }) => ({ id, name })),
    })),
    ...invites.map((i): PersonRow => ({
      id: null,
      invite_id: i.id,
      name: '',
      email: i.email,
      role: 'requester',
      status: i.expiresAt.getTime() > now ? 'invited' : 'expired',
      last_active_at: null,
      teams: [],
    })),
  ]
}

async function findUser(db: Db, id: string) {
  const [row] = await db.select({ id: user.id, role: user.role, deactivatedAt: user.deactivatedAt }).from(user).where(eq(user.id, id)).limit(1)
  if (!row) throw notFound('User')
  return row
}

const LAST_ADMIN = new PeopleError(409, 'LAST_ADMIN', 'There must be at least one active Admin. Make another User an Admin first.')

/**
 * Changes the Role of a User. The last-Admin check is in the UPDATE itself, so two Admins who
 * demote each other at the same time cannot both succeed. A Requester cannot be in a Team (see `canJoinTeam`).
 */
export async function changeRole(db: Db, principal: UserPrincipal, targetId: string, role: Role): Promise<void> {
  assertCanManagePeople(principal)
  const target = await findUser(db, targetId)
  if (target.role === role) return
  // Not a column reference, so the audit entry can use the same condition (see `onlyIf`).
  const mayChange = sql`(${role} = 'admin' OR (SELECT role FROM user WHERE id = ${targetId}) != 'admin' OR (SELECT deactivated_at FROM user WHERE id = ${targetId}) IS NOT NULL
        OR (SELECT count(*) FROM user WHERE role = 'admin' AND deactivated_at IS NULL) > 1)`
  try {
    await db.batch([
      adminAuditEntry(db, principal, { subject: { type: 'user', id: targetId }, action: 'role_changed', values: { before: { role: target.role }, after: { role } }, onlyIf: mayChange }),
      db.update(user).set({ role }).where(and(eq(user.id, targetId), mayChange)),
      db.delete(teamMember).where(and(
        eq(teamMember.userId, targetId),
        sql`(SELECT role FROM user WHERE id = ${targetId}) NOT IN ('admin', 'agent')`,
      )),
    ])
  } catch (error) {
    // The entry is refused when the guard is false, which rolls the batch back.
    if (String((error as Error).cause ?? error).includes('audit_log_one_principal')) throw LAST_ADMIN
    throw error
  }
}

/**
 * Deactivates a User at once: no new session, no session, no OAuth token. Access tokens are JWTs that stay
 * valid until they expire, so the MCP endpoint also checks `deactivated_at` on every call (ADR 0003).
 * Team memberships go too, so a deactivated User does not appear in a Team.
 */
export async function deactivateUser(db: Db, principal: UserPrincipal, targetId: string): Promise<void> {
  assertCanDeactivate(principal, targetId)
  const target = await findUser(db, targetId)
  if (target.deactivatedAt) return
  await db.batch([
    adminAuditEntry(db, principal, { subject: { type: 'user', id: targetId }, action: 'user_deactivated' }),
    db.update(user).set({ deactivatedAt: new Date() }).where(and(eq(user.id, targetId), sql`${user.deactivatedAt} IS NULL`)),
    db.delete(session).where(eq(session.userId, targetId)),
    db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, targetId)),
    db.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, targetId)),
    db.delete(teamMember).where(eq(teamMember.userId, targetId)),
  ])
}

/** The User signs in again and connects Claude again. Old tokens and Team memberships do not come back. */
export async function reactivateUser(db: Db, principal: UserPrincipal, targetId: string): Promise<void> {
  assertCanManagePeople(principal)
  const target = await findUser(db, targetId)
  if (!target.deactivatedAt) return
  await db.batch([
    adminAuditEntry(db, principal, { subject: { type: 'user', id: targetId }, action: 'user_reactivated' }),
    db.update(user).set({ deactivatedAt: null }).where(eq(user.id, targetId)),
  ])
}

// ---------- Invites ----------

const emailSchema = z.email()

interface InviteMail {
  mail: MailTransport
  config: Config
}

async function sendInviteMail({ mail, config }: InviteMail, db: Db, inviter: UserPrincipal, email: string) {
  const [org, [who]] = await Promise.all([
    getOrganization(db),
    db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, inviter.userId)).limit(1),
  ])
  const by = who?.name || who?.email || 'An Admin'
  try {
    await mail.send({
      to: email,
      subject: `${by} invited you to ${org.name}`,
      text: `${by} invited you to ${org.name}.\n\nSign in at ${config.appUrl}/sign-in with this email address. We send you a code; type it on the page.\nThe invite is valid for 30 days.`,
    })
  } catch (error) {
    console.error('invite mail failed', error)
    throw new PeopleError(502, 'MAIL_FAILED', 'The invite is saved, but the email could not be sent. Use Resend to try again.')
  }
}

/** Invites emails outside the allowed domains (3.16). All or none: any problem rejects the whole list. */
export async function createInvites(db: Db, deps: InviteMail, principal: UserPrincipal, rawEmails: string[], now = Date.now()): Promise<string[]> {
  assertCanManagePeople(principal)
  const emails = [...new Set(rawEmails.map(e => e.trim().toLowerCase()).filter(Boolean))]
  if (emails.length === 0) throw new PeopleError(422, 'VALIDATION_FAILED', 'The request has invalid values.', [{ key: 'emails', reason: 'Enter at least one email.' }])

  const [users, invites] = await Promise.all([
    db.select({ email: user.email }).from(user).where(inArray(user.email, emails)),
    db.select({ email: invite.email }).from(invite).where(inArray(invite.email, emails)),
  ])
  const hasAccount = new Set(users.map(u => u.email))
  const invited = new Set(invites.map(i => i.email))
  const problems: { key: string, reason: string }[] = []
  for (const email of emails) {
    const reason = !emailSchema.safeParse(email).success
      ? 'is not a valid email address.'
      : emailDomainAllowed(deps.config, email)
        ? 'is already allowed to sign in by domain, so it needs no invite.'
        : hasAccount.has(email)
          ? 'already has an account.'
          : invited.has(email)
            ? 'is already invited. Use Resend to send the invite again.'
            : null
    if (reason) problems.push({ key: 'emails', reason: `${email} ${reason}` })
  }
  if (problems.length) throw new PeopleError(422, 'VALIDATION_FAILED', 'The request has invalid values.', problems)

  await db.batch([
    db.insert(invite).values(emails.map(email => ({
      email,
      invitedBy: principal.userId,
      createdAt: new Date(now),
      expiresAt: new Date(now + INVITE_TTL_MS),
    }))),
    ...emails.map(email => adminAuditEntry(db, principal, {
      subject: { type: 'invite', id: sql`(select id from invite where email = ${email})` },
      action: 'user_invited',
      values: { after: { email } },
    })),
  ])
  // The rows are saved first: a failed email can then be sent again with Resend.
  for (const email of emails) await sendInviteMail(deps, db, principal, email)
  return emails
}

async function pendingInvite(db: Db, id: number) {
  const [row] = await db.select().from(invite).where(eq(invite.id, id)).limit(1)
  if (!row) throw notFound('invite')
  if (row.acceptedAt) throw new PeopleError(409, 'INVITE_ACCEPTED', 'This person has already signed in. Deactivate the User to stop access.')
  return row
}

export async function resendInvite(db: Db, deps: InviteMail, principal: UserPrincipal, id: number, now = Date.now()): Promise<void> {
  assertCanManagePeople(principal)
  const row = await pendingInvite(db, id)
  const expiresAt = new Date(now + INVITE_TTL_MS)
  await db.batch([
    db.update(invite).set({ expiresAt }).where(eq(invite.id, id)),
    adminAuditEntry(db, principal, { subject: { type: 'invite', id }, action: 'invite_resent', values: { before: { expires_at: row.expiresAt.toISOString() }, after: { expires_at: expiresAt.toISOString() } } }),
  ])
  await sendInviteMail(deps, db, principal, row.email)
}

export async function revokeInvite(db: Db, principal: UserPrincipal, id: number): Promise<void> {
  assertCanManagePeople(principal)
  const row = await pendingInvite(db, id)
  await db.batch([
    db.delete(invite).where(eq(invite.id, id)),
    adminAuditEntry(db, principal, { subject: { type: 'invite', id }, action: 'invite_revoked', values: { before: { email: row.email } } }),
  ])
}

// ---------- Teams ----------

export interface TeamView {
  id: number
  name: string
  members: { id: string, name: string, email: string, role: Role }[]
  owns: { id: number, name: string, prefix: string, icon: string, color: string }[]
}

async function teamViews(db: Db, only?: number): Promise<TeamView[]> {
  const byTeam = only === undefined ? undefined : eq(team.id, only)
  const [teams, members, types] = await db.batch([
    db.select({ id: team.id, name: team.name }).from(team).where(byTeam).orderBy(asc(team.name)),
    db.select({ teamId: teamMember.teamId, id: user.id, name: user.name, email: user.email, role: user.role })
      .from(teamMember).innerJoin(user, eq(user.id, teamMember.userId)).orderBy(asc(user.name), asc(user.email)),
    db.select({ teamId: ticketType.teamId, id: ticketType.id, name: ticketType.name, prefix: ticketType.prefix, icon: ticketType.icon, color: ticketType.color })
      .from(ticketType).orderBy(asc(ticketType.name)),
  ])
  const membersOf = Map.groupBy(members, m => m.teamId)
  const typesOf = Map.groupBy(types, t => t.teamId)
  return teams.map(t => ({
    ...t,
    members: (membersOf.get(t.id) ?? []).map(({ id, name, email, role }) => ({ id, name, email, role: role as Role })),
    owns: (typesOf.get(t.id) ?? []).map(({ id, name, prefix, icon, color }) => ({ id, name, prefix, icon, color })),
  }))
}

export async function listTeams(db: Db, principal: UserPrincipal): Promise<TeamView[]> {
  assertCanManagePeople(principal)
  return teamViews(db)
}

async function getTeam(db: Db, id: number): Promise<TeamView> {
  const [found] = await teamViews(db, id)
  if (!found) throw notFound('Team')
  return found
}

const nameTaken = (name: string) => new PeopleError(409, 'TEAM_NAME_TAKEN', `A Team named “${name}” already exists.`)

export async function createTeam(db: Db, principal: UserPrincipal, name: string): Promise<TeamView> {
  assertCanManagePeople(principal)
  try {
    const [[row]] = await db.batch([
      db.insert(team).values({ name }).returning({ id: team.id }),
      adminAuditEntry(db, principal, { subject: { type: 'team', id: sql`last_insert_rowid()` }, action: 'team_created', values: { after: { name } } }),
    ])
    return await getTeam(db, row!.id)
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken(name)
    throw error
  }
}

export async function renameTeam(db: Db, principal: UserPrincipal, id: number, name: string): Promise<TeamView> {
  assertCanManagePeople(principal)
  const [found] = await db.select({ name: team.name }).from(team).where(eq(team.id, id))
  if (!found) throw notFound('Team')
  if (found.name === name) return getTeam(db, id)
  try {
    await db.batch([
      db.update(team).set({ name }).where(eq(team.id, id)),
      adminAuditEntry(db, principal, { subject: { type: 'team', id }, action: 'team_renamed', values: { before: { name: found.name }, after: { name } } }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken(name)
    throw error
  }
  return getTeam(db, id)
}

/** A Team that owns Ticket Types cannot go: every type has a Team (4.13). */
export async function deleteTeam(db: Db, principal: UserPrincipal, id: number): Promise<void> {
  assertCanManagePeople(principal)
  const [found] = await db.select({ name: team.name, owned: count(ticketType.id) }).from(team)
    .leftJoin(ticketType, eq(ticketType.teamId, team.id)).where(eq(team.id, id)).groupBy(team.id)
  if (!found) throw notFound('Team')
  if (found.owned > 0) {
    throw new PeopleError(409, 'TEAM_OWNS_TYPES', `${found.name} owns ${found.owned} Ticket ${found.owned === 1 ? 'Type' : 'Types'}. Move ${found.owned === 1 ? 'it' : 'them'} to another Team first.`)
  }
  await db.batch([
    db.delete(teamMember).where(eq(teamMember.teamId, id)),
    db.delete(team).where(eq(team.id, id)),
    adminAuditEntry(db, principal, { subject: { type: 'team', id }, action: 'team_removed', values: { before: { name: found.name } } }),
  ])
}

export async function addTeamMember(db: Db, principal: UserPrincipal, teamId: number, userId: string): Promise<TeamView> {
  assertCanManagePeople(principal)
  const current = await getTeam(db, teamId)
  const target = await findUser(db, userId)
  if (target.deactivatedAt) throw new PeopleError(409, 'USER_DEACTIVATED', 'A deactivated User cannot join a Team.')
  if (!canJoinTeam(target.role)) throw new PeopleError(409, 'NOT_AN_AGENT', 'Only Agents and Admins can be in a Team. Make this User an Agent first.')
  if (current.members.some(m => m.id === userId)) return current
  await db.batch([
    db.insert(teamMember).values({ teamId, userId }),
    adminAuditEntry(db, principal, { subject: { type: 'team', id: teamId }, action: 'team_member_added', values: { after: { user_id: userId } } }),
  ])
  return getTeam(db, teamId)
}

export async function removeTeamMember(db: Db, principal: UserPrincipal, teamId: number, userId: string): Promise<TeamView> {
  assertCanManagePeople(principal)
  const current = await getTeam(db, teamId)
  if (!current.members.some(m => m.id === userId)) return current
  await db.batch([
    db.delete(teamMember).where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId))),
    adminAuditEntry(db, principal, { subject: { type: 'team', id: teamId }, action: 'team_member_removed', values: { before: { user_id: userId } } }),
  ])
  return getTeam(db, teamId)
}
