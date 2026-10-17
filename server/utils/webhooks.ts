import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { outboxEvent, TEST_EVENT, WEBHOOK_EVENTS, webhookDelivery, webhookEndpoint, type DeliveryState, type WebhookEventType } from '../db/schema'
import type { Db } from './auth'
import { config } from './env'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Wait after the 1st, 2nd, ... failed attempt. The last value repeats. */
const RETRY_DELAYS = [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR]
/** Retries stop this long after the Event (8.7). */
export const RETRY_WINDOW = DAY
/** An endpoint that fails for this long without one success is turned off (8.7). */
export const DISABLE_AFTER = 3 * DAY
/** Events and their deliveries are deleted this long after the Event (9.3). */
export const KEEP_FOR = 30 * DAY
// One run must stay inside the CPU and subrequest limits of the Free plan: at most ROUNDS × BATCH fetches, each with
// a timeout. Waiting on fetch costs no CPU.
const BATCH = 10
const ROUNDS = 3
const RUN_TIME = 20_000
const TIMEOUT = 10_000

// --- Endpoint URL (SSRF) -------------------------------------------------------------------------------------------

const PRIVATE_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/

function privateIpv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
}

function privateIpv6(host: string): boolean {
  if (!host.startsWith('[')) return false
  const h = host.slice(1, -1)
  // Loopback, unspecified, IPv4-mapped, unique local (fc00::/7), link-local (fe80::/10).
  return h === '::1' || h === '::' || h.startsWith('::ffff:') || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
}

const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/**
 * Why the URL cannot be an endpoint, or null. Only https, and no private or link-local address by name. The URL
 * parser has already turned other IPv4 forms (`2130706433`, `0x7f.1`) into dotted form. The Worker cannot see the
 * address that a public name resolves to, so this check works on the name only.
 */
export function endpointUrlProblem(value: string, appEnv = config.appEnv): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Must be an absolute URL, for example https://hooks.example.com/tickets.'
  }
  const host = url.hostname.toLowerCase()
  if (appEnv === 'development' && isLoopback(host)) return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'Must use https.'
  if (url.protocol !== 'https:') return 'Must use https.'
  if (url.username || url.password) return 'Must not contain a user name or password.'
  if (PRIVATE_NAMES.test(host) || privateIpv4(host) || privateIpv6(host)) return 'Must be a public address. Private, loopback and link-local addresses are refused.'
  return null
}

// --- Signing secret ------------------------------------------------------------------------------------------------

const encoder = new TextEncoder()
const toBase64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0))

/** A new secret in the Standard Webhooks format: `whsec_` and 32 random bytes in base64. */
function newSecret(): string {
  return `whsec_${toBase64(crypto.getRandomValues(new Uint8Array(32)))}`
}

let sealKey: Promise<CryptoKey> | undefined

/** AES-GCM key derived from BETTER_AUTH_SECRET, so a copy of the database alone does not give the secrets. */
function secretKey(): Promise<CryptoKey> {
  sealKey ??= crypto.subtle.importKey('raw', encoder.encode(config.authSecret), 'HKDF', false, ['deriveKey'])
    .then(base => crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encoder.encode('webhook-signing-secret') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    ))
  return sealKey
}

/** The endpoint ID is the additional data, so a sealed secret copied to another row does not open. */
async function sealSecret(endpointId: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(endpointId) }, await secretKey(), encoder.encode(secret))
  return `v1.${toBase64(iv)}.${toBase64(sealed)}`
}

async function openSecret(endpointId: string, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !data) throw new Error(`Webhook Endpoint ${endpointId} has a signing secret in an unknown format.`)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(endpointId) }, await secretKey(), fromBase64(data))
  return new TextDecoder().decode(plain)
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(secret.slice('whsec_'.length)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

/** Standard Webhooks signature: HMAC-SHA256 of `id.timestamp.body`, in base64, with the version prefix `v1,`. */
async function sign(key: CryptoKey, id: string, timestamp: number, body: string): Promise<string> {
  return `v1,${toBase64(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${body}`)))}`
}

// --- Endpoints -----------------------------------------------------------------------------------------------------

export type EndpointStatus = 'healthy' | 'failing' | 'off'

export interface EndpointView {
  id: string
  name: string
  url: string
  events: WebhookEventType[]
  include_internal: boolean
  enabled: boolean
  /** `off`: turned off by an Admin, or by the delivery run (then `disabled_at` is set). */
  status: EndpointStatus
  failing_since: string | null
  /** Failed attempts since the last success. */
  failures: number
  disabled_at: string | null
  /** The next retry of a pending delivery. */
  next_attempt_at: string | null
  last_delivery_at: string | null
  created_at: string
}

/** Shown once, on create and rotate. Never in any other response. */
export interface EndpointWithSecret extends EndpointView {
  secret: string
}

const eventsInput = z.array(z.enum(WEBHOOK_EVENTS, { error: `Must be one of ${WEBHOOK_EVENTS.join(', ')}.` }), { error: 'Must be a list of event types.' })
  .min(1, 'Choose at least one event.')
  .transform(events => WEBHOOK_EVENTS.filter(e => events.includes(e)))
const nameInput = z.string({ error: 'Must be text.' }).trim().min(1, 'Name is required.').max(80, 'Must be 80 characters or fewer.')
const urlInput = z.string({ error: 'Must be text.' }).trim().max(2000, 'Must be 2000 characters or fewer.').superRefine((value, ctx) => {
  const problem = endpointUrlProblem(value)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})
const internalInput = z.boolean({ error: 'Must be true or false.' })

export const endpointInput = z.strictObject({
  name: nameInput,
  url: urlInput,
  events: eventsInput.default([...WEBHOOK_EVENTS]),
  include_internal: internalInput.default(false),
})

export const endpointPatch = z.strictObject({
  name: nameInput.optional(),
  url: urlInput.optional(),
  events: eventsInput.optional(),
  include_internal: internalInput.optional(),
  enabled: z.boolean({ error: 'Must be true or false.' }).optional(),
})

const iso = (d: Date | null) => d?.toISOString() ?? null
const msToIso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString()

// Drizzle writes columns of a one-table select without the table name, so the subqueries name it themselves.
function selectEndpoints(db: Db) {
  return db.select({
    endpoint: webhookEndpoint,
    nextAttemptAt: sql<number | null>`(SELECT min(d.next_attempt_at) FROM webhook_delivery d WHERE d.endpoint_id = webhook_endpoint.id AND d.state = 'pending')`,
    lastDeliveryAt: sql<number | null>`(SELECT max(d.last_attempt_at) FROM webhook_delivery d WHERE d.endpoint_id = webhook_endpoint.id AND d.state = 'delivered')`,
  }).from(webhookEndpoint)
}

type EndpointRow = Awaited<ReturnType<typeof selectEndpoints>>[number]

function toView({ endpoint: e, nextAttemptAt, lastDeliveryAt }: EndpointRow): EndpointView {
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    events: e.events,
    include_internal: e.includeInternal,
    enabled: e.enabled,
    status: !e.enabled ? 'off' : e.failingSince ? 'failing' : 'healthy',
    failing_since: iso(e.failingSince),
    failures: e.failures,
    disabled_at: iso(e.disabledAt),
    next_attempt_at: e.enabled ? msToIso(nextAttemptAt) : null,
    last_delivery_at: msToIso(lastDeliveryAt),
    created_at: e.createdAt.toISOString(),
  }
}

export async function listEndpoints(db: Db): Promise<EndpointView[]> {
  return (await selectEndpoints(db).where(eq(webhookEndpoint.owner, 'admin')).orderBy(asc(webhookEndpoint.createdAt))).map(toView)
}

export async function getEndpoint(db: Db, id: string): Promise<EndpointView | null> {
  const [row] = await selectEndpoints(db).where(and(eq(webhookEndpoint.id, id), eq(webhookEndpoint.owner, 'admin'))).limit(1)
  return row ? toView(row) : null
}

export async function createEndpoint(db: Db, input: z.output<typeof endpointInput>): Promise<EndpointWithSecret> {
  const id = crypto.randomUUID()
  const secret = newSecret()
  await db.insert(webhookEndpoint).values({ id, name: input.name, url: input.url, events: input.events, includeInternal: input.include_internal, secret: await sealSecret(id, secret) })
  return { ...(await getEndpoint(db, id))!, secret }
}

/** Turning an endpoint on clears its failure state, so it gets 3 new days. */
export async function updateEndpoint(db: Db, id: string, input: z.output<typeof endpointPatch>): Promise<EndpointView | null> {
  const set: Partial<typeof webhookEndpoint.$inferInsert> = {}
  if (input.name !== undefined) set.name = input.name
  if (input.url !== undefined) set.url = input.url
  if (input.events !== undefined) set.events = input.events
  if (input.include_internal !== undefined) set.includeInternal = input.include_internal
  if (input.enabled !== undefined) {
    set.enabled = input.enabled
    if (input.enabled) Object.assign(set, { failingSince: null, failures: 0, disabledAt: null })
  }
  if (Object.keys(set).length) await db.update(webhookEndpoint).set(set).where(and(eq(webhookEndpoint.id, id), eq(webhookEndpoint.owner, 'admin')))
  return getEndpoint(db, id)
}

/** Deletes the endpoint and its deliveries. The Events stay for other endpoints until the purge. */
export async function deleteEndpoint(db: Db, id: string): Promise<boolean> {
  if (!await getEndpoint(db, id)) return false
  await db.batch([
    db.delete(webhookDelivery).where(eq(webhookDelivery.endpointId, id)),
    db.delete(webhookEndpoint).where(eq(webhookEndpoint.id, id)),
  ])
  return true
}

/** The old secret stops at once: the next delivery is signed with the new one. */
export async function rotateSecret(db: Db, id: string): Promise<EndpointWithSecret | null> {
  if (!await getEndpoint(db, id)) return null
  const secret = newSecret()
  await db.update(webhookEndpoint).set({ secret: await sealSecret(id, secret) }).where(eq(webhookEndpoint.id, id))
  return { ...(await getEndpoint(db, id))!, secret }
}

// --- Delivery log --------------------------------------------------------------------------------------------------

export interface DeliveryView {
  id: number
  event_id: string
  type: string
  /** The Ticket Reference at the time of the Event. Null for a test event. */
  ticket_ref: string | null
  changed: string[]
  state: DeliveryState
  attempts: number
  response_status: number | null
  error: string | null
  last_attempt_at: string | null
  next_attempt_at: string | null
  created_at: string
}

const DELIVERY_LOG_LIMIT = 50

const deliveryColumns = {
  id: webhookDelivery.id,
  eventId: webhookDelivery.eventId,
  type: outboxEvent.type,
  ref: sql<string | null>`json_extract(${outboxEvent.payload}, '$.after.ref')`,
  changed: sql<string | null>`json_extract(${outboxEvent.payload}, '$.changed')`,
  state: webhookDelivery.state,
  attempts: webhookDelivery.attempts,
  responseStatus: webhookDelivery.responseStatus,
  error: webhookDelivery.error,
  lastAttemptAt: webhookDelivery.lastAttemptAt,
  nextAttemptAt: webhookDelivery.nextAttemptAt,
  createdAt: webhookDelivery.createdAt,
}

function selectDeliveries(db: Db) {
  return db.select(deliveryColumns).from(webhookDelivery).innerJoin(outboxEvent, eq(webhookDelivery.eventId, outboxEvent.id))
}

type DeliveryRow = Awaited<ReturnType<typeof selectDeliveries>>[number]

function toDelivery(r: DeliveryRow): DeliveryView {
  return {
    id: r.id,
    event_id: r.eventId,
    type: r.type,
    ticket_ref: r.ref,
    changed: r.changed ? JSON.parse(r.changed) as string[] : [],
    state: r.state,
    attempts: r.attempts,
    response_status: r.responseStatus,
    error: r.error,
    last_attempt_at: iso(r.lastAttemptAt),
    next_attempt_at: iso(r.nextAttemptAt),
    created_at: r.createdAt.toISOString(),
  }
}

/** The newest deliveries of one endpoint, without payloads: the log loads a payload only when it is opened. */
export async function listDeliveries(db: Db, endpointId: string): Promise<DeliveryView[]> {
  const rows = await selectDeliveries(db).where(eq(webhookDelivery.endpointId, endpointId)).orderBy(desc(webhookDelivery.id)).limit(DELIVERY_LOG_LIMIT)
  return rows.map(toDelivery)
}

/** One delivery with its payload: the exact text that was signed and sent. */
export async function getDelivery(db: Db, endpointId: string, id: number): Promise<(DeliveryView & { payload: string }) | null> {
  const [row] = await db.select({ ...deliveryColumns, payload: outboxEvent.payload }).from(webhookDelivery)
    .innerJoin(outboxEvent, eq(webhookDelivery.eventId, outboxEvent.id))
    .where(and(eq(webhookDelivery.endpointId, endpointId), eq(webhookDelivery.id, id))).limit(1)
  return row ? { ...toDelivery(row), payload: row.payload } : null
}

// --- Delivery ------------------------------------------------------------------------------------------------------

/**
 * Tells the Admins that the delivery run turned an endpoint off. Issue 18 (Inbox) puts one notification for each
 * Admin here; until then the log line is the only signal.
 */
export async function notifyAdminsEndpointDisabled(_db: Db, endpoint: { id: string, name: string }): Promise<void> {
  console.warn(`Webhook Endpoint "${endpoint.name}" (${endpoint.id}) was turned off after ${DISABLE_AFTER / DAY} days of failed deliveries.`)
}

interface Attempt {
  ok: boolean
  status: number | null
  error: string | null
}

async function post(url: string, headers: Record<string, string>, body: string): Promise<Attempt> {
  try {
    // No redirects: a redirect could point to an address that the URL check refuses.
    const res = await globalThis.fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) })
    await res.body?.cancel()
    const ok = res.status >= 200 && res.status < 300
    return { ok, status: res.status, error: ok ? null : `HTTP ${res.status}` }
  } catch (error) {
    const message = error instanceof Error ? (error.name === 'TimeoutError' ? `No response in ${TIMEOUT / 1000} s.` : error.message) : String(error)
    return { ok: false, status: null, error: message.slice(0, 300) }
  }
}

function nextAttempt(attempts: number, eventAt: Date, now: Date): Date | null {
  const next = now.getTime() + RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length) - 1]!
  return next > eventAt.getTime() + RETRY_WINDOW ? null : new Date(next)
}

/** One round: sends up to BATCH due deliveries in parallel and records the results in one batch. Returns how many it sent. */
async function deliverRound(db: Db, now: Date, only?: { endpointId: string, deliveryId?: number }): Promise<number> {
  const rows = await db.select({
    id: webhookDelivery.id,
    attempts: webhookDelivery.attempts,
    eventAt: webhookDelivery.createdAt,
    eventId: outboxEvent.id,
    payload: outboxEvent.payload,
    endpoint: { id: webhookEndpoint.id, name: webhookEndpoint.name, url: webhookEndpoint.url, secret: webhookEndpoint.secret, failingSince: webhookEndpoint.failingSince },
  }).from(webhookDelivery)
    .innerJoin(outboxEvent, eq(webhookDelivery.eventId, outboxEvent.id))
    .innerJoin(webhookEndpoint, eq(webhookDelivery.endpointId, webhookEndpoint.id))
    .where(and(
      eq(webhookDelivery.state, 'pending'),
      lte(webhookDelivery.nextAttemptAt, now),
      eq(webhookEndpoint.enabled, true),
      only ? eq(webhookDelivery.endpointId, only.endpointId) : undefined,
      only?.deliveryId !== undefined ? eq(webhookDelivery.id, only.deliveryId) : undefined,
    ))
    .orderBy(asc(webhookDelivery.nextAttemptAt), asc(webhookDelivery.id))
    .limit(BATCH)
  if (rows.length === 0) return 0

  const keys = new Map<string, Promise<CryptoKey>>()
  const keyFor = (e: typeof rows[number]['endpoint']) => {
    if (!keys.has(e.id)) keys.set(e.id, openSecret(e.id, e.secret).then(signingKey))
    return keys.get(e.id)!
  }
  const timestamp = Math.floor(now.getTime() / 1000)
  const results = await Promise.all(rows.map(async (r) => {
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'Ticketing-Webhooks/1',
      'webhook-id': r.eventId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': await sign(await keyFor(r.endpoint), r.eventId, timestamp, r.payload),
    }
    return { row: r, attempt: await post(r.endpoint.url, headers, r.payload) }
  }))

  const statements = []
  const byEndpoint = new Map<string, { endpoint: typeof rows[number]['endpoint'], ok: boolean, failed: number }>()
  for (const { row, attempt } of results) {
    const attempts = row.attempts + 1
    const next = attempt.ok ? null : nextAttempt(attempts, row.eventAt, now)
    statements.push(db.update(webhookDelivery).set({
      state: attempt.ok ? 'delivered' : next ? 'pending' : 'failed',
      attempts,
      nextAttemptAt: next,
      lastAttemptAt: now,
      responseStatus: attempt.status,
      error: attempt.error,
    }).where(eq(webhookDelivery.id, row.id)))
    const sum = byEndpoint.get(row.endpoint.id) ?? { endpoint: row.endpoint, ok: false, failed: 0 }
    if (attempt.ok) sum.ok = true
    else sum.failed++
    byEndpoint.set(row.endpoint.id, sum)
  }

  const disabled: { id: string, name: string }[] = []
  for (const { endpoint, ok, failed } of byEndpoint.values()) {
    if (ok) {
      statements.push(db.update(webhookEndpoint).set({ failingSince: null, failures: 0 }).where(eq(webhookEndpoint.id, endpoint.id)))
      continue
    }
    const since = endpoint.failingSince ?? now
    if (now.getTime() - since.getTime() >= DISABLE_AFTER) {
      disabled.push(endpoint)
      statements.push(
        db.update(webhookEndpoint).set({ enabled: false, disabledAt: now, failingSince: since, failures: sql`${webhookEndpoint.failures} + ${failed}` }).where(eq(webhookEndpoint.id, endpoint.id)),
        // Nothing waits for an endpoint that is off. When it is turned on again, only new Events go to it.
        db.update(webhookDelivery).set({ state: 'failed', nextAttemptAt: null }).where(and(eq(webhookDelivery.endpointId, endpoint.id), eq(webhookDelivery.state, 'pending'))),
      )
    } else {
      statements.push(db.update(webhookEndpoint).set({ failingSince: since, failures: sql`${webhookEndpoint.failures} + ${failed}` }).where(eq(webhookEndpoint.id, endpoint.id)))
    }
  }
  await db.batch(statements as [typeof statements[number], ...typeof statements])
  for (const endpoint of disabled) await notifyAdminsEndpointDisabled(db, endpoint)
  return rows.length
}

/** Sends the due deliveries, at least once each. Bounded in rounds and time, so one run stays small. */
export async function deliverDue(db: Db, now: Date, only?: { endpointId: string, deliveryId?: number }): Promise<void> {
  const start = Date.now()
  for (let round = 0; round < ROUNDS && Date.now() - start < RUN_TIME; round++) {
    if (await deliverRound(db, now, only) < BATCH) return
  }
}

/** Deletes Events older than 30 days and their deliveries, in every state (9.3). Retries end long before. */
async function purge(db: Db, now: Date) {
  const cutoff = new Date(now.getTime() - KEEP_FOR)
  await db.batch([
    db.delete(webhookDelivery).where(inArray(webhookDelivery.eventId, db.select({ id: outboxEvent.id }).from(outboxEvent).where(lt(outboxEvent.createdAt, cutoff)))),
    db.delete(outboxEvent).where(lt(outboxEvent.createdAt, cutoff)),
  ])
}

/** The scheduled handler (Cron Trigger, every minute). `now` is the scheduled time, so tests control the clock. */
export async function runOutbox(db: Db, now: Date): Promise<void> {
  await deliverDue(db, now)
  await purge(db, now)
}

export class EndpointOff extends Error {
  constructor() {
    super('This endpoint is off. Turn it on first.')
    this.name = 'EndpointOff'
  }
}

/** Puts every pending delivery of the endpoint first and sends them now. */
export async function retryNow(db: Db, id: string): Promise<EndpointView | null> {
  const endpoint = await getEndpoint(db, id)
  if (!endpoint) return null
  if (!endpoint.enabled) throw new EndpointOff()
  const now = new Date()
  await db.update(webhookDelivery).set({ nextAttemptAt: now }).where(and(eq(webhookDelivery.endpointId, id), eq(webhookDelivery.state, 'pending')))
  await deliverDue(db, now, { endpointId: id })
  return getEndpoint(db, id)
}

/** Sends a `webhook.test` Event to this endpoint only, now, and returns its delivery. It retries like any Event. */
export async function sendTestEvent(db: Db, id: string): Promise<DeliveryView | null> {
  const endpoint = await getEndpoint(db, id)
  if (!endpoint) return null
  if (!endpoint.enabled) throw new EndpointOff()
  const eventId = crypto.randomUUID()
  const now = new Date()
  const payload = JSON.stringify({ event_id: eventId, type: TEST_EVENT, created_at: now.toISOString(), endpoint: { id, name: endpoint.name } })
  const [, [delivery]] = await db.batch([
    db.insert(outboxEvent).values({ id: eventId, type: TEST_EVENT, ticketNumber: null, internal: false, payload, createdAt: now }),
    db.insert(webhookDelivery).values({ eventId, endpointId: id, state: 'pending', nextAttemptAt: now, createdAt: now }).returning({ id: webhookDelivery.id }),
  ])
  await deliverDue(db, now, { endpointId: id, deliveryId: delivery!.id })
  const sent = await getDelivery(db, id, delivery!.id)
  if (!sent) return null
  const { payload: _, ...view } = sent
  return view
}
