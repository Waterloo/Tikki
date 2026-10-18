import { and, asc, eq, inArray, isNotNull, isNull, sql, type SQLWrapper } from 'drizzle-orm'
import { waitUntil } from 'cloudflare:workers'
import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet } from 'jose'
import { z } from 'zod'
import { accessAbove, type NormalizedManifest } from '../../shared/ticket-app-manifest'
import { APP_ICONS, DEFAULT_APP_ICON, DEFAULT_APP_ICON_COLOR, type AppIconMode, type TicketAppIcon } from '../../shared/ticket-app-icons'
import { TYPE_COLORS } from '../../shared/ticket-type-rules'
import { ticket, ticketApp, ticketType, TICKET_APP_ACCESS, user, type TicketAppAccess, type TicketAppPlacement } from '../db/schema'
import { adminAuditEntry } from './audit'
import type { Db, Role } from './auth'
import type { AppEnv } from './config'
import { config, env } from './env'
import { isStaffRole, visibleAppPages } from './policy'
import { useAuth } from './services'
import { parseTicketReference, type RequesterView, type TicketDetail, type UserPrincipal } from './tickets'

/** The token lives 5 minutes (ADR 0004). */
export const CONTEXT_TOKEN_SECONDS = 5 * 60

export class TicketAppError extends Error {
  constructor(readonly status: 404 | 409 | 422, readonly code: 'NOT_FOUND' | 'VALIDATION_FAILED' | 'MANIFEST_CHANGED', message: string, readonly details: { key: string, reason: string }[] | null = null) {
    super(message)
    this.name = 'TicketAppError'
  }
}

export const notFound = () => new TicketAppError(404, 'NOT_FOUND', 'No Ticket App has this ID.')
export const invalid = (details: { key: string, reason: string }[]) => new TicketAppError(422, 'VALIDATION_FAILED', 'The request has invalid values.', details)

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
// Null or empty: the placement is off.
const urlInput = z.string({ error: 'Must be text or null.' }).trim().max(2000, 'URL must be 2000 characters or fewer.')
  .superRefine((value, ctx) => {
    const problem = value === '' ? null : appUrlProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
  .transform(value => value === '' ? null : value)
  .nullable()
// Null is "All Ticket Types". A list must name at least one type.
export const typeIdsInput = z.array(z.number({ error: 'Must be Ticket Type IDs.' }).int().positive(), { error: 'Must be null or a list of Ticket Type IDs.' })
  .min(1, 'Choose at least one Ticket Type, or show the app on all types.')
  .nullable()
export const enabledInput = z.boolean({ error: 'Must be true or false.' })
export const accessInput = z.enum(TICKET_APP_ACCESS, { error: `Must be one of ${TICKET_APP_ACCESS.join(', ')}.` })
export const pageForRequestersInput = z.boolean({ error: 'Must be true or false.' })

const iconNameInput = z.enum(APP_ICONS.map(i => i.icon) as [string, ...string[]], { error: 'Must be one of the built-in icons.' })
const iconColorInput = z.enum(TYPE_COLORS.map(c => c.color) as [string, ...string[]], { error: 'Must be one of the Ticket Type colors.' })

export const ticketAppCreateInput = z.strictObject({
  name: nameInput,
  sidebar_url: urlInput.default(null),
  tab_url: urlInput.default(null),
  page_url: urlInput.default(null),
  ticket_type_ids: typeIdsInput.default(null),
  access: accessInput.default('read'),
  enabled: enabledInput.default(true),
  icon_name: iconNameInput.default(DEFAULT_APP_ICON),
  icon_color: iconColorInput.default(DEFAULT_APP_ICON_COLOR),
  page_for_requesters: pageForRequestersInput.default(false),
})

export const ticketAppUpdateInput = z.strictObject({
  name: nameInput.optional(),
  sidebar_url: urlInput.optional(),
  tab_url: urlInput.optional(),
  page_url: urlInput.optional(),
  ticket_type_ids: typeIdsInput.optional(),
  access: accessInput.optional(),
  enabled: enabledInput.optional(),
  icon_name: iconNameInput.optional(),
  icon_color: iconColorInput.optional(),
  page_for_requesters: pageForRequestersInput.optional(),
})

export const ticketAppMoveInput = z.strictObject({ direction: z.enum(['up', 'down'], { error: 'Must be up or down.' }) })

/** The URL of each placement. Null: the placement is off. At least one is set. */
export type TicketAppUrls = Record<TicketAppPlacement, string | null>

/** The placements that show in a ticket. `page` shows outside tickets (issue 39). */
export const FRAME_PLACEMENTS = ['sidebar', 'tab'] as const satisfies readonly TicketAppPlacement[]
export type FramePlacement = typeof FRAME_PLACEMENTS[number]

export interface TicketAppView {
  id: number
  name: string
  urls: TicketAppUrls
  /** Null: all Ticket Types. Archived types are left out. */
  ticket_type_ids: number[] | null
  access: TicketAppAccess
  enabled: boolean
  icon: TicketAppIcon
  /** Issue 39: Requesters also see the page. False when there is no page URL. */
  page_for_requesters: boolean
  /** Issue 40: the app was added from this manifest. `access` is the access the app asks for. */
  manifest: { url: string, description: string | null, access: TicketAppAccess } | null
  created_at: string
}

/** What the ticket page needs to show an app. */
export interface TicketAppFrame {
  id: number
  name: string
  urls: TicketAppUrls
  icon: TicketAppIcon
}

type Row = typeof ticketApp.$inferSelect

const urlsOf = (row: Pick<Row, 'sidebarUrl' | 'tabUrl' | 'pageUrl'>): TicketAppUrls => ({ sidebar: row.sidebarUrl, tab: row.tabUrl, page: row.pageUrl })
type IconColumns = Pick<Row, 'iconName' | 'iconColor' | 'iconLightType' | 'iconDarkType' | 'iconVersion'>
const iconColumns = { iconName: ticketApp.iconName, iconColor: ticketApp.iconColor, iconLightType: ticketApp.iconLightType, iconDarkType: ticketApp.iconDarkType, iconVersion: ticketApp.iconVersion }

export const iconOf = (row: IconColumns): TicketAppIcon => ({
  kind: row.iconLightType ? 'image' : 'builtin',
  name: row.iconName,
  color: row.iconColor,
  light: row.iconLightType !== null,
  dark: row.iconDarkType !== null,
  version: row.iconVersion,
})

/** The R2 key of an icon image. One object for each app and mode; the row says whether it exists. */
export const iconKey = (appId: number, mode: AppIconMode) => `ticket-app-icons/${appId}/${mode}`

/** Deletes icon objects after the response. A failure is logged: an orphan object is harmless, a missing one is not. */
export function dropIconObjects(appId: number, modes: readonly AppIconMode[]): void {
  waitUntil(env.FILES.delete(modes.map(m => iconKey(appId, m))).catch(error => console.error(`Icon objects of Ticket App ${appId} were not deleted`, error)))
}

const urlColumns = { sidebarUrl: ticketApp.sidebarUrl, tabUrl: ticketApp.tabUrl, pageUrl: ticketApp.pageUrl }
export const noUrl = () => invalid([{ key: 'urls', reason: 'Set at least one URL: sidebar, tab or page.' }])
// Refused, not reset: a silent change of who sees the page would surprise the Admin.
export const noPageForRequesters = () => invalid([{ key: 'page_for_requesters', reason: 'Set a page URL first. Only the page can show to Requesters.' }])
/** Issue 40: the granted access is never above the access in the manifest. */
export const accessNotRequested = (requested: TicketAppAccess) => invalid([{ key: 'access', reason: `The app's manifest asks for ${requested} access. Grant ${requested} or lower.` }])

async function activeTypeIds(db: Db): Promise<Set<number>> {
  const rows = await db.select({ id: ticketType.id }).from(ticketType).where(isNull(ticketType.archivedAt))
  return new Set(rows.map(r => r.id))
}

function toView(row: Row, active: Set<number>): TicketAppView {
  return {
    id: row.id,
    name: row.name,
    urls: urlsOf(row),
    ticket_type_ids: row.ticketTypeIds === null ? null : row.ticketTypeIds.filter(id => active.has(id)),
    access: row.access,
    enabled: row.enabled,
    icon: iconOf(row),
    page_for_requesters: row.pageForRequesters,
    manifest: row.manifestUrl && row.manifest ? { url: row.manifestUrl, description: row.manifest.description, access: row.manifest.access } : null,
    created_at: row.createdAt.toISOString(),
  }
}

export async function listTicketApps(db: Db): Promise<TicketAppView[]> {
  const [rows, active] = await Promise.all([db.select().from(ticketApp).orderBy(asc(ticketApp.sortOrder), asc(ticketApp.id)), activeTypeIds(db)])
  return rows.map(r => toView(r, active))
}

export async function getRow(db: Db, id: number): Promise<Row> {
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

export type Audited = Pick<Row, 'name' | 'sidebarUrl' | 'tabUrl' | 'pageUrl' | 'ticketTypeIds' | 'access' | 'pageForRequesters'> & IconColumns
// The icon is the kind and the version, never the bytes.
export const audited = (row: Audited) => ({ name: row.name, sidebar_url: row.sidebarUrl, tab_url: row.tabUrl, page_url: row.pageUrl, ticket_type_ids: row.ticketTypeIds, access: row.access, page_for_requesters: row.pageForRequesters, icon: iconOf(row) })

/** The manifest that the Admin approved (issue 40). */
export interface ApprovedManifest {
  url: string
  hash: string
  manifest: NormalizedManifest
}

export async function createTicketApp(db: Db, principal: UserPrincipal, input: z.infer<typeof ticketAppCreateInput>, approved?: ApprovedManifest): Promise<TicketAppView> {
  if (!input.sidebar_url && !input.tab_url && !input.page_url) throw noUrl()
  if (input.page_for_requesters && !input.page_url) throw noPageForRequesters()
  const ticketTypeIds = await checkTypeIds(db, input.ticket_type_ids)
  const manifestColumns = approved ? { manifestUrl: approved.url, manifestHash: approved.hash, manifest: approved.manifest } : {}
  const values = { name: input.name, sidebarUrl: input.sidebar_url, tabUrl: input.tab_url, pageUrl: input.page_url, ticketTypeIds, access: input.access, iconName: input.icon_name, iconColor: input.icon_color, iconLightType: null, iconDarkType: null, iconVersion: 0, pageForRequesters: input.page_for_requesters }
  const [[created]] = await db.batch([
    db.insert(ticketApp).values({
      ...values,
      ...manifestColumns,
      enabled: input.enabled,
      sortOrder: sql`(SELECT coalesce(max(${ticketApp.sortOrder}), 0) + 1 FROM ${ticketApp})`,
      createdAt: new Date(),
    }).returning(),
    adminAuditEntry(db, principal, { subject: { type: 'ticket_app', id: sql`last_insert_rowid()` }, action: 'ticket_app_created', values: { after: { ...audited(values), enabled: input.enabled, ...(approved && { manifest_url: approved.url, manifest_hash: approved.hash }) } } }),
  ])
  return toView(created!, await activeTypeIds(db))
}

export async function updateTicketApp(db: Db, principal: UserPrincipal, id: number, input: z.infer<typeof ticketAppUpdateInput>): Promise<TicketAppView> {
  const current = await getRow(db, id)
  const next = {
    name: input.name ?? current.name,
    sidebarUrl: input.sidebar_url === undefined ? current.sidebarUrl : input.sidebar_url,
    tabUrl: input.tab_url === undefined ? current.tabUrl : input.tab_url,
    pageUrl: input.page_url === undefined ? current.pageUrl : input.page_url,
    ticketTypeIds: current.ticketTypeIds,
    access: input.access ?? current.access,
    iconName: input.icon_name ?? current.iconName,
    iconColor: input.icon_color ?? current.iconColor,
    iconLightType: current.iconLightType,
    iconDarkType: current.iconDarkType,
    iconVersion: current.iconVersion,
    pageForRequesters: input.page_for_requesters ?? current.pageForRequesters,
  }
  if (!next.sidebarUrl && !next.tabUrl && !next.pageUrl) throw noUrl()
  if (next.pageForRequesters && !next.pageUrl) throw noPageForRequesters()
  if (input.access && current.manifest && accessAbove(input.access, current.manifest.access)) throw accessNotRequested(current.manifest.access)
  if (input.ticket_type_ids !== undefined) next.ticketTypeIds = await checkTypeIds(db, input.ticket_type_ids)
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
  dropIconObjects(id, ['light', 'dark'])
}

/** On, and shown on this type: all types, or a chosen type that is not archived. */
function shownOn(typeId: number | SQLWrapper) {
  return and(
    eq(ticketApp.enabled, true),
    sql`(${ticketApp.ticketTypeIds} IS NULL OR EXISTS (
      SELECT 1 FROM json_each(${ticketApp.ticketTypeIds}) j JOIN ${ticketType} t ON t.id = j.value
      WHERE j.value = ${typeId} AND t.archived_at IS NULL))`,
  )
}

/** The apps of a ticket of this type, in the admin order. The caller checked that the User may see them. */
export async function appsForType(db: Db, typeId: number): Promise<TicketAppFrame[]> {
  const rows = await db.select({ id: ticketApp.id, name: ticketApp.name, ...urlColumns, ...iconColumns }).from(ticketApp)
    .where(shownOn(typeId)).orderBy(asc(ticketApp.sortOrder), asc(ticketApp.id))
  return rows.map(r => ({ id: r.id, name: r.name, urls: urlsOf(r), icon: iconOf(r) }))
}

/** The context of the guide (docs/ticket-apps-reference.md#the-context), without `theme`: the browser adds it. */
export interface AppContext {
  version: 1
  app: { id: number, name: string, placement: FramePlacement }
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

export const contextTokenInput = z.strictObject({
  placement: z.enum(FRAME_PLACEMENTS, { error: `Must be one of ${FRAME_PLACEMENTS.join(', ')}.` }),
})

/**
 * A signed context token and the context for one placement of one app on one ticket. The caller checked the role and
 * the read rule (`getTicket`). Throws NOT_FOUND for an app that is off, not shown on the ticket's type, or has no URL
 * for the placement.
 */
export async function contextToken(db: Db, principal: UserPrincipal, appId: number, placement: FramePlacement, t: TicketDetail, now = Date.now()): Promise<ContextToken> {
  const [[row], [agent]] = await Promise.all([
    db.select({ id: ticketApp.id, name: ticketApp.name, ...urlColumns, access: ticketApp.access }).from(ticketApp)
      .where(and(eq(ticketApp.id, appId), shownOn(t.ticket_type.id))).limit(1),
    db.select({ id: user.id, name: user.name, email: user.email, role: user.role }).from(user).where(eq(user.id, principal.userId)).limit(1),
  ])
  const url = row && urlsOf(row)[placement]
  if (!row || !url) throw notFound()
  const app = { ...row, url }
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
        tikki_placement: placement,
        tikki_ticket: t.ref,
        tikki_scope: app.access,
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
      app: { id: app.id, name: app.name, placement },
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

// --- App pages (issue 39) -------------------------------------------------------------------------------------------

/** An entry of the Apps menu. `url` is the page URL. */
export interface AppPageView {
  id: number
  name: string
  url: string
  icon: TicketAppIcon
}

/** On, with a page URL, and one this User may see. Ticket Types do not apply: a page is outside any ticket. */
const pageShownTo = (principal: UserPrincipal) => and(eq(ticketApp.enabled, true), isNotNull(ticketApp.pageUrl), visibleAppPages(principal))

/** The app pages this User may open, in the admin order. */
export async function appPagesFor(db: Db, principal: UserPrincipal): Promise<AppPageView[]> {
  const rows = await db.select({ id: ticketApp.id, name: ticketApp.name, url: ticketApp.pageUrl, ...iconColumns }).from(ticketApp)
    .where(pageShownTo(principal)).orderBy(asc(ticketApp.sortOrder), asc(ticketApp.id))
  return rows.map(r => ({ id: r.id, name: r.name, url: r.url!, icon: iconOf(r) }))
}

/** True when this User may open the app's page. A Requester may then also see its icon. */
export async function appPageShownTo(db: Db, principal: UserPrincipal, id: number): Promise<boolean> {
  return await db.$count(ticketApp, and(eq(ticketApp.id, id), pageShownTo(principal))) > 0
}

/** The context of an app page (docs/ticket-apps-reference.md#the-page-context), without `theme`. No ticket and no requester. */
export interface PageContext {
  version: 1
  app: { id: number, name: string, placement: 'page' }
  user: { id: string, name: string, email: string, role: string }
}

export interface PageToken {
  token: string
  expires_at: string
  data: PageContext
}

/**
 * A page token and the page context (ADR 0005). The token proves who the User is and nothing more: it has no
 * `tikki_ticket` and no `tikki_scope`, so `principalForContextToken` refuses it. Throws NOT_FOUND for an app this User
 * may not see, an app that is off, or one without a page URL.
 */
export async function pageToken(db: Db, principal: UserPrincipal, appId: number, now = Date.now()): Promise<PageToken> {
  const [[app], [me]] = await Promise.all([
    db.select({ id: ticketApp.id, name: ticketApp.name, url: ticketApp.pageUrl }).from(ticketApp)
      .where(and(eq(ticketApp.id, appId), pageShownTo(principal))).limit(1),
    db.select({ id: user.id, name: user.name, email: user.email, role: user.role }).from(user).where(eq(user.id, principal.userId)).limit(1),
  ])
  if (!app?.url) throw notFound()
  if (!me) throw new Error(`User ${principal.userId} has a session but no row.`)

  const iat = Math.floor(now / 1000)
  const exp = iat + CONTEXT_TOKEN_SECONDS
  const { token } = await useAuth().api.signJWT({
    body: {
      payload: {
        iss: `${config.appUrl}/api/auth`,
        aud: new URL(app.url).origin,
        sub: me.id,
        tikki_app: app.id,
        tikki_placement: 'page',
        tikki_role: me.role,
        iat,
        exp,
      },
    },
  })
  return {
    token,
    expires_at: new Date(exp * 1000).toISOString(),
    data: { version: 1, app: { id: app.id, name: app.name, placement: 'page' }, user: me },
  }
}

/** Each level includes the ones before it. */
const ACCESS_RANK: Record<TicketAppAccess, number> = { read: 0, comment: 1, update: 2 }

const isAccess = (v: unknown): v is TicketAppAccess => typeof v === 'string' && (TICKET_APP_ACCESS as readonly string[]).includes(v)
const isFramePlacement = (v: unknown): v is FramePlacement => typeof v === 'string' && (FRAME_PLACEMENTS as readonly string[]).includes(v)

/** A JWT in compact form. An API key (`gt_live_...`) has no dots. */
export function looksLikeJwt(credential: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(credential)
}

/**
 * The User behind a context token, limited to its ticket and access (issue 35), or null for any token that is not
 * valid now. Valid: Tikki's signature and issuer, not expired, `aud` the origin of the URL of `tikki_placement` of the
 * app in `tikki_app` (so a token for one view cannot be used by another view's origin, ADR 0005), that app on
 * and still shown on the ticket's type, and `sub` an active Agent or Admin. An MCP access token has no `tikki_app` and
 * fails. A page token (issue 39) has no `tikki_ticket` and `tikki_placement: 'page'`, so it fails too: it must never
 * reach a ticket. The access is the lower of the token's and the app's current one, so a lowered access applies at once.
 */
export async function principalForContextToken(db: Db, token: string): Promise<UserPrincipal | null> {
  let claims
  try {
    const jwks = createLocalJWKSet(await useAuth().api.getJwks() as JSONWebKeySet)
    ;({ payload: claims } = await jwtVerify(token, jwks, { issuer: `${config.appUrl}/api/auth`, requiredClaims: ['exp', 'sub', 'aud'] }))
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return null
    throw error
  }
  const { aud, sub, tikki_app: appId, tikki_placement: placement, tikki_ticket: ref, tikki_scope: scope } = claims
  if (typeof aud !== 'string' || typeof sub !== 'string' || !Number.isSafeInteger(appId) || !isFramePlacement(placement) || typeof ref !== 'string' || !isAccess(scope)) return null
  const number = parseTicketReference(ref)
  if (number === null) return null

  const [[app], [agent]] = await Promise.all([
    db.select({ ...urlColumns, access: ticketApp.access }).from(ticketApp)
      .innerJoin(ticket, eq(ticket.number, number))
      .where(and(eq(ticketApp.id, appId as number), shownOn(ticket.ticketTypeId))).limit(1),
    db.select({ role: user.role, deactivatedAt: user.deactivatedAt }).from(user).where(eq(user.id, sub)).limit(1),
  ])
  const url = app && urlsOf(app)[placement]
  if (!app || !url || new URL(url).origin !== aud) return null
  if (!agent || agent.deactivatedAt !== null || !isStaffRole(agent.role)) return null
  const access = ACCESS_RANK[app.access] < ACCESS_RANK[scope] ? app.access : scope
  return { kind: 'user', userId: sub, role: agent.role as Role, channel: 'app', ticketApp: { id: appId as number, ticketNumber: number, access } }
}
