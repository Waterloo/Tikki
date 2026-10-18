import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ticketApp, ticketType, TICKET_APP_POSITIONS, user, type TicketAppPosition } from '../db/schema'
import { adminAuditEntry } from './audit'
import type { Db } from './auth'
import type { AppEnv } from './config'
import { config } from './env'
import { useAuth } from './services'
import type { RequesterView, TicketDetail, UserPrincipal } from './tickets'

/** The token lives 5 minutes (ADR 0004). */
export const CONTEXT_TOKEN_SECONDS = 5 * 60
/** Issue 35 adds `comment` and `update`. */
const SCOPE = 'read'

export class TicketAppError extends Error {
  constructor(readonly status: 404 | 422, readonly code: 'NOT_FOUND' | 'VALIDATION_FAILED', message: string, readonly details: { key: string, reason: string }[] | null = null) {
    super(message)
    this.name = 'TicketAppError'
  }
}

const notFound = () => new TicketAppError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
const invalid = (details: { key: string, reason: string }[]) => new TicketAppError(422, 'VALIDATION_FAILED', 'The request has invalid values.', details)

const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/**
 * Why the URL cannot be a Ticket App, or null. Only https; `http://localhost` only on a development or test
 * instance. Never Tikki's own origin: with `allow-scripts allow-same-origin` a same-origin frame can remove its sandbox.
 */
export function appUrlProblem(value: string, appEnv: AppEnv = config.appEnv, appUrl = config.appUrl): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Must be an absolute URL, for example https://orders.example.com/tikki.'
  }
  const local = (appEnv === 'development' || appEnv === 'test') && isLoopback(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return 'Must use https.'
  if (url.username || url.password) return 'Must not contain a user name or password.'
  if (url.origin === new URL(appUrl).origin) return 'Must be on another origin than Tikki.'
  return null
}

const nameInput = z.string({ error: 'Must be text.' }).trim().min(1, 'Name is required.').max(40, 'Name must be 40 characters or fewer.')
const urlInput = z.string({ error: 'Must be text.' }).trim().max(2000, 'URL must be 2000 characters or fewer.')
  .superRefine((value, ctx) => {
    const problem = appUrlProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
const positionInput = z.enum(TICKET_APP_POSITIONS, { error: `Must be one of ${TICKET_APP_POSITIONS.join(', ')}.` })
// Null is "All Ticket Types". A list must name at least one type.
const typeIdsInput = z.array(z.number({ error: 'Must be Ticket Type IDs.' }).int().positive(), { error: 'Must be null or a list of Ticket Type IDs.' })
  .min(1, 'Choose at least one Ticket Type, or show the app on all types.')
  .nullable()
const enabledInput = z.boolean({ error: 'Must be true or false.' })

export const ticketAppCreateInput = z.strictObject({
  name: nameInput,
  url: urlInput,
  position: positionInput,
  ticket_type_ids: typeIdsInput.default(null),
  enabled: enabledInput.default(true),
})

export const ticketAppUpdateInput = z.strictObject({
  name: nameInput.optional(),
  url: urlInput.optional(),
  position: positionInput.optional(),
  ticket_type_ids: typeIdsInput.optional(),
  enabled: enabledInput.optional(),
})

export const ticketAppMoveInput = z.strictObject({ direction: z.enum(['up', 'down'], { error: 'Must be up or down.' }) })

export interface TicketAppView {
  id: number
  name: string
  url: string
  position: TicketAppPosition
  /** Null: all Ticket Types. Archived types are left out. */
  ticket_type_ids: number[] | null
  enabled: boolean
  created_at: string
}

/** What the ticket page needs to show an app. */
export interface TicketAppFrame {
  id: number
  name: string
  url: string
  position: TicketAppPosition
}

type Row = typeof ticketApp.$inferSelect

async function activeTypeIds(db: Db): Promise<Set<number>> {
  const rows = await db.select({ id: ticketType.id }).from(ticketType).where(isNull(ticketType.archivedAt))
  return new Set(rows.map(r => r.id))
}

function toView(row: Row, active: Set<number>): TicketAppView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    position: row.position,
    ticket_type_ids: row.ticketTypeIds === null ? null : row.ticketTypeIds.filter(id => active.has(id)),
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
  }
}

export async function listTicketApps(db: Db): Promise<TicketAppView[]> {
  const [rows, active] = await Promise.all([db.select().from(ticketApp).orderBy(asc(ticketApp.sortOrder), asc(ticketApp.id)), activeTypeIds(db)])
  return rows.map(r => toView(r, active))
}

async function getRow(db: Db, id: number): Promise<Row> {
  const [row] = await db.select().from(ticketApp).where(eq(ticketApp.id, id)).limit(1)
  if (!row) throw notFound()
  return row
}

/** Each chosen type must exist and not be archived. Returns the list without repeats. */
async function checkTypeIds(db: Db, ids: number[] | null): Promise<number[] | null> {
  if (ids === null) return null
  const unique = [...new Set(ids)]
  const found = await db.select({ id: ticketType.id }).from(ticketType).where(and(inArray(ticketType.id, unique), isNull(ticketType.archivedAt)))
  if (found.length !== unique.length) throw invalid([{ key: 'ticket_type_ids', reason: 'Each ID must be a Ticket Type that is not archived.' }])
  return unique
}

const audited = (row: Pick<Row, 'name' | 'url' | 'position' | 'ticketTypeIds'>) => ({ name: row.name, url: row.url, position: row.position, ticket_type_ids: row.ticketTypeIds })

export async function createTicketApp(db: Db, principal: UserPrincipal, input: z.infer<typeof ticketAppCreateInput>): Promise<TicketAppView> {
  const ticketTypeIds = await checkTypeIds(db, input.ticket_type_ids)
  const values = { name: input.name, url: input.url, position: input.position, ticketTypeIds }
  const [[created]] = await db.batch([
    db.insert(ticketApp).values({
      ...values,
      enabled: input.enabled,
      sortOrder: sql`(SELECT coalesce(max(${ticketApp.sortOrder}), 0) + 1 FROM ${ticketApp})`,
      createdAt: new Date(),
    }).returning(),
    adminAuditEntry(db, principal, { subject: { type: 'ticket_app', id: sql`last_insert_rowid()` }, action: 'ticket_app_created', values: { after: { ...audited(values), enabled: input.enabled } } }),
  ])
  return toView(created!, await activeTypeIds(db))
}

export async function updateTicketApp(db: Db, principal: UserPrincipal, id: number, input: z.infer<typeof ticketAppUpdateInput>): Promise<TicketAppView> {
  const current = await getRow(db, id)
  const next = {
    name: input.name ?? current.name,
    url: input.url ?? current.url,
    position: input.position ?? current.position,
    ticketTypeIds: input.ticket_type_ids === undefined ? current.ticketTypeIds : await checkTypeIds(db, input.ticket_type_ids),
  }
  const before = audited(current)
  const after = audited(next)
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  const subject = { type: 'ticket_app', id } as const
  const writes = []
  if (changed.length) {
    writes.push(adminAuditEntry(db, principal, {
      subject,
      action: 'ticket_app_changed',
      values: { before: Object.fromEntries(changed.map(k => [k, before[k]])), after: Object.fromEntries(changed.map(k => [k, after[k]])) },
    }))
  }
  if (input.enabled !== undefined && input.enabled !== current.enabled) {
    writes.push(adminAuditEntry(db, principal, { subject, action: input.enabled ? 'ticket_app_enabled' : 'ticket_app_disabled' }))
  }
  if (writes.length) {
    await db.batch([db.update(ticketApp).set({ ...next, enabled: input.enabled ?? current.enabled }).where(eq(ticketApp.id, id)), ...writes])
  }
  return toView(await getRow(db, id), await activeTypeIds(db))
}

/** Swaps the app with its neighbour. At the top or bottom it changes nothing. */
export async function moveTicketApp(db: Db, principal: UserPrincipal, id: number, direction: 'up' | 'down'): Promise<TicketAppView[]> {
  const rows = await db.select({ id: ticketApp.id, sortOrder: ticketApp.sortOrder }).from(ticketApp).orderBy(asc(ticketApp.sortOrder), asc(ticketApp.id))
  const index = rows.findIndex(r => r.id === id)
  if (index === -1) throw notFound()
  const other = rows[direction === 'up' ? index - 1 : index + 1]
  if (other) {
    const me = rows[index]!
    // Distinct values, so an old tie in `sort_order` cannot make the swap a no-op.
    const [mine, theirs] = me.sortOrder === other.sortOrder
      ? (direction === 'up' ? [me.sortOrder, me.sortOrder + 1] : [me.sortOrder + 1, me.sortOrder])
      : [other.sortOrder, me.sortOrder]
    await db.batch([
      db.update(ticketApp).set({ sortOrder: mine }).where(eq(ticketApp.id, me.id)),
      db.update(ticketApp).set({ sortOrder: theirs }).where(eq(ticketApp.id, other.id)),
      adminAuditEntry(db, principal, { subject: { type: 'ticket_app', id }, action: 'ticket_app_moved', values: { before: { order: index + 1 }, after: { order: direction === 'up' ? index : index + 2 } } }),
    ])
  }
  return listTicketApps(db)
}

export async function deleteTicketApp(db: Db, principal: UserPrincipal, id: number): Promise<void> {
  const current = await getRow(db, id)
  await db.batch([
    db.delete(ticketApp).where(eq(ticketApp.id, id)),
    adminAuditEntry(db, principal, { subject: { type: 'ticket_app', id }, action: 'ticket_app_deleted', values: { before: audited(current) } }),
  ])
}

/** On, and shown on this type: all types, or a chosen type that is not archived. */
function shownOn(typeId: number) {
  return and(
    eq(ticketApp.enabled, true),
    sql`(${ticketApp.ticketTypeIds} IS NULL OR EXISTS (
      SELECT 1 FROM json_each(${ticketApp.ticketTypeIds}) j JOIN ${ticketType} t ON t.id = j.value
      WHERE j.value = ${typeId} AND t.archived_at IS NULL))`,
  )
}

/** The apps of a ticket of this type, in the admin order. The caller checked that the User may see them. */
export async function appsForType(db: Db, typeId: number): Promise<TicketAppFrame[]> {
  return db.select({ id: ticketApp.id, name: ticketApp.name, url: ticketApp.url, position: ticketApp.position }).from(ticketApp)
    .where(shownOn(typeId)).orderBy(asc(ticketApp.sortOrder), asc(ticketApp.id))
}

/** The context of the guide (docs/ticket-apps.md#the-context), without `theme`: the browser adds it. */
export interface AppContext {
  version: 1
  app: { id: number, name: string, position: TicketAppPosition }
  agent: { id: string, name: string, email: string, role: string }
  ticket: {
    ref: string
    number: number
    url: string
    title: string
    priority: TicketDetail['priority']
    status: TicketDetail['status']
    ticket_type: { id: number, name: string, prefix: string }
    team: { id: number, name: string } | null
    assignee: TicketDetail['assignee']
    fields: TicketDetail['fields']
    schema_fields: { key: string, label: string, type: string }[]
    channel: TicketDetail['channel']
    application: TicketDetail['application']
    created_at: string
    updated_at: string
  }
  requester: RequesterView
}

export interface ContextToken {
  token: string
  expires_at: string
  data: AppContext
}

/**
 * A signed context token and the context for one app on one ticket. The caller checked the role and the read rule
 * (`getTicket`). Throws NOT_FOUND for an app that is off or not shown on the ticket's type.
 */
export async function contextToken(db: Db, principal: UserPrincipal, appId: number, t: TicketDetail, now = Date.now()): Promise<ContextToken> {
  const [[app], [agent]] = await Promise.all([
    db.select({ id: ticketApp.id, name: ticketApp.name, url: ticketApp.url, position: ticketApp.position }).from(ticketApp)
      .where(and(eq(ticketApp.id, appId), shownOn(t.ticket_type.id))).limit(1),
    db.select({ id: user.id, name: user.name, email: user.email, role: user.role }).from(user).where(eq(user.id, principal.userId)).limit(1),
  ])
  if (!app) throw notFound()
  if (!agent) throw new Error(`User ${principal.userId} has a session but no row.`)

  const iat = Math.floor(now / 1000)
  const exp = iat + CONTEXT_TOKEN_SECONDS
  const { token } = await useAuth().api.signJWT({
    body: {
      payload: {
        iss: `${config.appUrl}/api/auth`,
        aud: new URL(app.url).origin,
        sub: agent.id,
        tikki_app: app.id,
        tikki_ticket: t.ref,
        tikki_scope: SCOPE,
        iat,
        exp,
      },
    },
  })
  return {
    token,
    expires_at: new Date(exp * 1000).toISOString(),
    data: {
      version: 1,
      app: { id: app.id, name: app.name, position: app.position },
      agent,
      ticket: {
        ref: t.ref,
        number: t.number,
        url: `${config.appUrl}/tickets/${t.ref}`,
        title: t.title,
        priority: t.priority,
        status: t.status,
        ticket_type: { id: t.ticket_type.id, name: t.ticket_type.name, prefix: t.ticket_type.prefix },
        team: t.team ?? null,
        assignee: t.assignee,
        fields: t.fields,
        schema_fields: t.schema_fields.map(f => ({ key: f.key, label: f.label, type: f.type })),
        channel: t.channel,
        application: t.application,
        created_at: t.created_at,
        updated_at: t.updated_at,
      },
      requester: t.requester,
    },
  }
}
