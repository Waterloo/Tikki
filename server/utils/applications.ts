import { and, asc, count, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import { z } from 'zod'
import { apiKey, application, APPLICATION_PERMISSIONS, contact, ticket, ticketType } from '../db/schema'
import type { Db } from './auth'
import type { ApplicationPrincipal } from './tickets'

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
  | { ok: true, principal: ApplicationPrincipal }
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
    principal: { kind: 'application', applicationId: row.applicationId, permissions: row.permissions, ticketTypeIds: row.ticketTypeIds, channel: 'api' },
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
  ticket_types: { id: number, name: string, prefix: string, icon: string, color: string }[]
  keys: ApiKeyView[]
  created_at: string
}

const nameInput = z.string({ error: 'Must be text.' }).trim().min(1, 'Name is required.').max(80, 'Name must be 80 characters or fewer.')
const descriptionInput = z.string({ error: 'Must be text.' }).trim().max(500, 'Description must be 500 characters or fewer.')
const permissionsInput = z.array(z.enum(APPLICATION_PERMISSIONS, { error: `Must be one of ${APPLICATION_PERMISSIONS.join(', ')}.` }), { error: 'Must be a list.' })
const typeIdsInput = z.array(z.number({ error: 'Must be Ticket Type IDs.' }).int().positive(), { error: 'Must be a list of Ticket Type IDs.' })

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
  const found = await db.select({ id: ticketType.id }).from(ticketType).where(inArray(ticketType.id, unique))
  const missingIds = unique.filter(id => !found.some(f => f.id === id))
  if (missingIds.length) throw new ApplicationInputError([{ key: 'ticket_type_ids', reason: `No Ticket Type has the ID ${missingIds.join(', ')}.` }])
  return unique
}

async function checkNameFree(db: Db, name: string, exceptId?: number) {
  const [taken] = await db.select({ id: application.id }).from(application).where(eq(application.name, name)).limit(1)
  if (taken && taken.id !== exceptId) throw new ApplicationInputError([{ key: 'name', reason: 'Another Application has this name.' }])
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
    permissions: APPLICATION_PERMISSIONS.filter(p => app.permissions.includes(p)),
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

/** Null when no Application has this ID. Disabling refuses its keys at once, because each request reads the flag. */
export async function updateApplication(db: Db, id: number, input: z.output<typeof applicationUpdateInput>): Promise<ApplicationDetail | null> {
  const [app] = await db.select({ id: application.id, disabledAt: application.disabledAt }).from(application).where(eq(application.id, id)).limit(1)
  if (!app) return null
  const set: Partial<typeof application.$inferInsert> = {}
  if (input.name !== undefined) {
    await checkNameFree(db, input.name, id)
    set.name = input.name
  }
  if (input.description !== undefined) set.description = input.description
  if (input.permissions !== undefined) set.permissions = [...new Set(input.permissions)]
  if (input.ticket_type_ids !== undefined) set.ticketTypeIds = await checkTypeIds(db, input.ticket_type_ids)
  // Keep the first disable time when an Admin disables twice.
  if (input.enabled !== undefined) set.disabledAt = input.enabled ? null : (app.disabledAt ?? new Date())
  if (Object.keys(set).length) await db.update(application).set(set).where(eq(application.id, id))
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
