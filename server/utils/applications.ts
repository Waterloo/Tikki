import { and, asc, count, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import { z } from 'zod'
import { apiKey, application, APPLICATION_PERMISSIONS, contact, ticket, TICKET_SCOPES, ticketType, type ApplicationPermission, type TicketScopes } from '../db/schema'
import { adminAuditEntry } from './audit'
import type { Db } from './auth'
import type { ApplicationPrincipal, UserPrincipal } from './tickets'

export const API_KEY_PREFIX = 'gt_live_'
/** `gt_live_` and the first 4 characters of the secret: enough to tell keys apart, far too few to guess the rest. */
const SHOWN_PREFIX_LENGTH = API_KEY_PREFIX.length + 4
/** Writing `last_used_at` on every request would add a D1 write to each call. A minute is precise enough for the list. */
const LAST_USED_PRECISION_MS = 60_000

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A new key: `gt_live_` and 32 random bytes in hex. Only its SHA-256 is stored.
 * A fast hash is enough: the key has 256 bits of entropy, so nobody can guess it from the hash, and a slow hash
 * (bcrypt, PBKDF2) would spend the CPU budget of every API request on the check.
 */
async function newKey() {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  const key = `${API_KEY_PREFIX}${secret}`
  return { key, hash: await sha256Hex(key), prefix: key.slice(0, SHOWN_PREFIX_LENGTH) }
}

export type KeyCheck =
  | { ok: true, principal: ApplicationPrincipal, limits: { requests: number, creates: number } }
  | { ok: false, reason: 'invalid' | 'disabled' }

/**
 * The Principal for an API key. A revoked key and an unknown key give the same answer.
 * The lookup is by hash, so no stored secret is compared byte by byte: timing can only tell an attacker about the
 * hash of their own guess, which says nothing about a real key. No constant-time compare is needed.
 */
export async function principalForKey(db: Db, key: string): Promise<KeyCheck> {
  if (!key.startsWith(API_KEY_PREFIX)) return { ok: false, reason: 'invalid' }
  const [row] = await db.select({
    keyId: apiKey.id,
    lastUsedAt: apiKey.lastUsedAt,
    applicationId: application.id,
    permissions: application.permissions,
    ticketTypeIds: application.ticketTypeIds,
    disabledAt: application.disabledAt,
    rateLimit: application.rateLimit,
    createLimit: application.createLimit,
    scopes: application.ticketScopes,
    includeRestricted: application.includeRestricted,
  }).from(apiKey)
    .innerJoin(application, eq(apiKey.applicationId, application.id))
    .where(and(eq(apiKey.keyHash, await sha256Hex(key)), isNull(apiKey.revokedAt)))
    .limit(1)
  if (!row) return { ok: false, reason: 'invalid' }
  if (row.disabledAt !== null) return { ok: false, reason: 'disabled' }

  const now = Date.now()
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_PRECISION_MS) {
    await db.update(apiKey).set({ lastUsedAt: new Date(now) }).where(eq(apiKey.id, row.keyId))
  }
  return {
    ok: true,
    principal: { kind: 'application', applicationId: row.applicationId, permissions: row.permissions, ticketTypeIds: row.ticketTypeIds, scopes: row.scopes, includeRestricted: row.includeRestricted, channel: 'api' },
    limits: { requests: row.rateLimit, creates: row.createLimit },
  }
}

// Admin management (Applications screen).

export interface ApiKeyView {
  id: number
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
}

export interface ApplicationSummary {
  id: number
  name: string
  description: string
  enabled: boolean
  ticket_count: number
  last_used_at: string | null
}

export interface ApplicationDetail extends ApplicationSummary {
  permissions: string[]
  /** Issue 42: which tickets each permission reaches. */
  ticket_scopes: TicketScopes
  include_restricted: boolean
  ticket_types: { id: number, name: string, prefix: string, icon: string, color: string }[]
  rate_limit: number
  create_limit: number
  keys: ApiKeyView[]
  created_at: string
}

const nameInput = z.string({ error: 'Must be text.' }).trim().min(1, 'Name is required.').max(80, 'Name must be 80 characters or fewer.')
const descriptionInput = z.string({ error: 'Must be text.' }).trim().max(500, 'Description must be 500 characters or fewer.')
const permissionsInput = z.array(z.enum(APPLICATION_PERMISSIONS, { error: `Must be one of ${APPLICATION_PERMISSIONS.join(', ')}.` }), { error: 'Must be a list.' })
const typeIdsInput = z.array(z.number({ error: 'Must be Ticket Type IDs.' }).int().positive(), { error: 'Must be a list of Ticket Type IDs.' })

const scopeInput = z.enum(TICKET_SCOPES, { error: 'Must be own or all.' })
const scopesInput = z.strictObject({ read: scopeInput, update: scopeInput, comment: scopeInput }, { error: 'Must be an object with read, update and comment.' })

const limitInput = z.number({ error: 'Must be a whole number.' }).int('Must be a whole number.').min(1, 'Must be at least 1.').max(10_000, 'Must be 10000 or fewer.')

export const applicationCreateInput = z.strictObject({
  name: nameInput,
  description: descriptionInput.default(''),
  permissions: permissionsInput.default([]),
  ticket_type_ids: typeIdsInput.default([]),
})

export const applicationUpdateInput = z.strictObject({
  name: nameInput.optional(),
  description: descriptionInput.optional(),
  permissions: permissionsInput.optional(),
  ticket_type_ids: typeIdsInput.optional(),
  enabled: z.boolean({ error: 'Must be true or false.' }).optional(),
  rate_limit: limitInput.optional(),
  create_limit: limitInput.optional(),
  ticket_scopes: scopesInput.optional(),
  include_restricted: z.boolean({ error: 'Must be true or false.' }).optional(),
})

export const keyCreateInput = z.strictObject({ name: nameInput })

export class ApplicationInputError extends Error {
  constructor(readonly details: { key: string, reason: string }[]) {
    super(details.map(d => `${d.key}: ${d.reason}`).join(' '))
    this.name = 'ApplicationInputError'
  }
}

/** Unknown type IDs would sit in the JSON list unseen, so they are refused here. */
async function checkTypeIds(db: Db, ids: number[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) return unique
  const found = await db.select({ id: ticketType.id, name: ticketType.name, visibility: ticketType.visibility }).from(ticketType).where(inArray(ticketType.id, unique))
  const missingIds = unique.filter(id => !found.some(f => f.id === id))
  if (missingIds.length) throw new ApplicationInputError([{ key: 'ticket_type_ids', reason: `No Ticket Type has the ID ${missingIds.join(', ')}.` }])
  // A Contact cannot be a Participant, so an Application cannot have Restricted tickets (3.32).
  const restricted = found.filter(f => f.visibility === 'participants')
  if (restricted.length) throw new ApplicationInputError([{ key: 'ticket_type_ids', reason: `${restricted.map(f => f.name).join(', ')} is Participants only. An Application cannot use it.` }])
  return unique
}

async function checkNameFree(db: Db, name: string, exceptId?: number) {
  const [taken] = await db.select({ id: application.id }).from(application).where(eq(application.name, name)).limit(1)
  if (taken && taken.id !== exceptId) throw new ApplicationInputError([{ key: 'name', reason: 'Another Application has this name.' }])
}

const SCOPE_PERMISSION: Record<keyof TicketScopes, ApplicationPermission> = { read: 'tickets:read', update: 'tickets:update', comment: 'comments:create' }

/**
 * Issue 42. Checked on the result of each change, so removing a permission cannot leave its `all` scope behind. The
 * policy also fails closed (`scopeOf`), so a bad row never widens a rule.
 */
function checkScopes(permissions: readonly ApplicationPermission[], scopes: TicketScopes, includeRestricted: boolean) {
  const errors: { key: string, reason: string }[] = []
  for (const key of ['read', 'update', 'comment'] as const) {
    if (scopes[key] === 'all' && !permissions.includes(SCOPE_PERMISSION[key])) errors.push({ key: `ticket_scopes.${key}`, reason: `All tickets needs the ${SCOPE_PERMISSION[key]} permission.` })
  }
  for (const key of ['update', 'comment'] as const) {
    if (scopes[key] === 'all' && scopes.read !== 'all') errors.push({ key: `ticket_scopes.${key}`, reason: 'All tickets needs read on all tickets too.' })
  }
  if (includeRestricted && !Object.values(scopes).includes('all')) errors.push({ key: 'include_restricted', reason: 'Restricted tickets need at least one permission on all tickets.' })
  if (errors.length) throw new ApplicationInputError(errors)
}

function iso(date: Date | null) {
  return date ? date.toISOString() : null
}

export async function listApplications(db: Db): Promise<ApplicationSummary[]> {
  const [apps, tickets, used] = await Promise.all([
    db.select().from(application).orderBy(asc(application.name)),
    db.select({ applicationId: contact.applicationId, count: count() }).from(ticket)
      .innerJoin(contact, eq(ticket.contactId, contact.id)).groupBy(contact.applicationId),
    db.select({ applicationId: apiKey.applicationId, lastUsedAt: max(apiKey.lastUsedAt) }).from(apiKey).groupBy(apiKey.applicationId),
  ])
  return apps.map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    enabled: a.disabledAt === null,
    ticket_count: tickets.find(t => t.applicationId === a.id)?.count ?? 0,
    last_used_at: iso(used.find(u => u.applicationId === a.id)?.lastUsedAt ?? null),
  }))
}

export async function getApplication(db: Db, id: number): Promise<ApplicationDetail | null> {
  const [[app], [tickets], keys] = await Promise.all([
    db.select().from(application).where(eq(application.id, id)).limit(1),
    db.select({ count: count() }).from(ticket).innerJoin(contact, eq(ticket.contactId, contact.id)).where(eq(contact.applicationId, id)),
    db.select().from(apiKey).where(and(eq(apiKey.applicationId, id), isNull(apiKey.revokedAt))).orderBy(desc(apiKey.createdAt), desc(apiKey.id)),
  ])
  if (!app) return null
  const types = app.ticketTypeIds.length
    ? await db.select({ id: ticketType.id, name: ticketType.name, prefix: ticketType.prefix, icon: ticketType.icon, color: ticketType.color })
      .from(ticketType).where(inArray(ticketType.id, app.ticketTypeIds)).orderBy(asc(ticketType.name))
    : []
  const lastUsed = keys.reduce<Date | null>((latest, k) => (k.lastUsedAt && (!latest || k.lastUsedAt > latest) ? k.lastUsedAt : latest), null)
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    enabled: app.disabledAt === null,
    ticket_count: tickets?.count ?? 0,
    last_used_at: iso(lastUsed),
    rate_limit: app.rateLimit,
    create_limit: app.createLimit,
    permissions: APPLICATION_PERMISSIONS.filter(p => app.permissions.includes(p)),
    ticket_scopes: app.ticketScopes,
    include_restricted: app.includeRestricted,
    ticket_types: types,
    keys: keys.map(k => ({ id: k.id, name: k.name, prefix: k.prefix, created_at: k.createdAt.toISOString(), last_used_at: iso(k.lastUsedAt) })),
    created_at: app.createdAt.toISOString(),
  }
}

export async function createApplication(db: Db, input: z.output<typeof applicationCreateInput>): Promise<ApplicationDetail> {
  await checkNameFree(db, input.name)
  const ticketTypeIds = await checkTypeIds(db, input.ticket_type_ids)
  const [created] = await db.insert(application).values({
    name: input.name,
    description: input.description,
    permissions: [...new Set(input.permissions)],
    ticketTypeIds,
  }).returning({ id: application.id })
  return (await getApplication(db, created!.id))!
}

/**
 * Null when no Application has this ID. Disabling refuses its keys at once, because each request reads the flag.
 * Each change writes one `application_changed` entry with the old and new values of the changed keys.
 */
export async function updateApplication(db: Db, principal: UserPrincipal, id: number, input: z.output<typeof applicationUpdateInput>): Promise<ApplicationDetail | null> {
  const [app] = await db.select().from(application).where(eq(application.id, id)).limit(1)
  if (!app) return null
  const set: Partial<typeof application.$inferInsert> = {}
  if (input.name !== undefined) {
    await checkNameFree(db, input.name, id)
    set.name = input.name
  }
  if (input.description !== undefined) set.description = input.description
  if (input.permissions !== undefined) set.permissions = [...new Set(input.permissions)]
  if (input.ticket_type_ids !== undefined) set.ticketTypeIds = await checkTypeIds(db, input.ticket_type_ids)
  const nextRate = input.rate_limit ?? app.rateLimit
  const nextCreate = input.create_limit ?? app.createLimit
  if (nextCreate > nextRate) throw new ApplicationInputError([{ key: 'create_limit', reason: 'Creates are part of the requests, so this cannot be more than the request limit.' }])
  if (input.rate_limit !== undefined) set.rateLimit = input.rate_limit
  if (input.create_limit !== undefined) set.createLimit = input.create_limit
  if (input.ticket_scopes !== undefined) set.ticketScopes = input.ticket_scopes
  if (input.include_restricted !== undefined) set.includeRestricted = input.include_restricted
  checkScopes(set.permissions ?? app.permissions, set.ticketScopes ?? app.ticketScopes, set.includeRestricted ?? app.includeRestricted)
  // Keep the first disable time when an Admin disables twice.
  if (input.enabled !== undefined) set.disabledAt = input.enabled ? null : (app.disabledAt ?? new Date())

  const audited = (a: typeof app) => ({
    name: a.name, description: a.description, permissions: a.permissions, ticket_type_ids: a.ticketTypeIds, enabled: a.disabledAt === null,
    rate_limit: a.rateLimit, create_limit: a.createLimit, ticket_scopes: a.ticketScopes, include_restricted: a.includeRestricted,
  })
  const before = audited(app)
  const after = audited({ ...app, ...set })
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  if (changed.length) {
    await db.batch([
      db.update(application).set(set).where(eq(application.id, id)),
      adminAuditEntry(db, principal, {
        subject: { type: 'application', id },
        action: 'application_changed',
        values: { before: Object.fromEntries(changed.map(k => [k, before[k]])), after: Object.fromEntries(changed.map(k => [k, after[k]])) },
      }),
    ])
  }
  return getApplication(db, id)
}

/** The full key is in this result only. Null when no Application has this ID. */
export async function createApiKey(db: Db, applicationId: number, name: string, createdBy: string): Promise<(ApiKeyView & { key: string }) | null> {
  const [app] = await db.select({ id: application.id }).from(application).where(eq(application.id, applicationId)).limit(1)
  if (!app) return null
  const { key, hash, prefix } = await newKey()
  const [row] = await db.insert(apiKey).values({ applicationId, name, keyHash: hash, prefix, createdBy }).returning()
  return { id: row!.id, name: row!.name, prefix: row!.prefix, created_at: row!.createdAt.toISOString(), last_used_at: null, key }
}

/** False when the Application has no such key that is still active. */
export async function revokeApiKey(db: Db, applicationId: number, keyId: number): Promise<boolean> {
  const revoked = await db.update(apiKey).set({ revokedAt: new Date() })
    .where(and(eq(apiKey.id, keyId), eq(apiKey.applicationId, applicationId), isNull(apiKey.revokedAt)))
    .returning({ id: apiKey.id })
  return revoked.length > 0
}
