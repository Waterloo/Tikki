import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, postJson, signInAs, typeId } from './helpers'
// @ts-expect-error The build output has no types.
import builtWorker from '../../.output/server/index.mjs'

const built = builtWorker as ExportedHandler<Cloudflare.Env>

type Session = Awaited<ReturnType<typeof signInAs>>

interface Endpoint { id: string, name: string, url: string, events: string[], include_internal: boolean, enabled: boolean, status: string, failing_since: string | null, failures: number, disabled_at: string | null, next_attempt_at: string | null, secret?: string }
interface Delivery { id: number, event_id: string, type: string, ticket_ref: string | null, changed: string[], state: string, attempts: number, response_status: number | null, last_attempt_at: string | null, next_attempt_at: string | null, created_at: string }
interface TicketView { number: number, ref: string, title: string, priority: string, status: { key: string, name: string, category: string }, assignee: { id: string } | null, fields: Record<string, unknown>, ticket_type: { prefix: string }, updated_at: string }
interface Payload { event_id: string, type: string, created_at: string, changed: string[], actor: { kind: string, id: string, name: string, channel: string }, before: TicketView | null, after: TicketView, comment?: { id: string, visibility: string, body: string } }
interface Received { url: string, headers: Headers, body: string, payload: Payload }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const headers = (s: Session) => ({ cookie: s.cookie })

/** The fake receiver: every fetch to `https://hooks.test-receiver.com` lands here, and answers with `status`. */
const receiver = { status: 200, requests: [] as Received[] }

beforeEach(async () => {
  // Storage is shared by the tests of this file, so endpoints of earlier tests would get these Events too.
  await env.DB.batch(['DELETE FROM webhook_delivery', 'DELETE FROM outbox_event', 'DELETE FROM webhook_endpoint'].map(q => env.DB.prepare(q)))
  receiver.status = 200
  receiver.requests = []
  const real = globalThis.fetch
  // The Worker runs in the test isolate, so its outgoing fetch is this one.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init)
    if (!request.url.startsWith('https://hooks.test-receiver.com/')) return real(input as RequestInfo, init)
    const body = await request.text()
    receiver.requests.push({ url: request.url, headers: request.headers, body, payload: JSON.parse(body) as Payload })
    return new Response(null, { status: receiver.status })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs the scheduled handler of the built Worker, as the Cron Trigger does, at a time the test chooses. */
async function runCron(at: number) {
  const ctx = createExecutionContext()
  await built.scheduled!(createScheduledController({ scheduledTime: at, cron: '* * * * *' }), env, ctx)
  await waitOnExecutionContext(ctx)
}

async function addEndpoint(admin: Session, body: Record<string, unknown> = {}) {
  const res = await postJson('/api/v1/webhooks', { name: 'Team tool', url: `https://hooks.test-receiver.com/${crypto.randomUUID()}`, ...body }, headers(admin))
  expect(res.status).toBe(201)
  return await res.json() as Endpoint & { secret: string }
}

async function createTicket(s: Session, prefix = 'BUG') {
  const fields = prefix === 'BUG' ? { page_or_feature: 'Reports' } : {}
  const res = await postJson('/api/v1/tickets', { ticket_type_id: await typeId(s.cookie, prefix), title: 'Export fails', fields }, headers(s))
  expect(res.status).toBe(201)
  return await res.json() as TicketView
}

const patch = (s: Session, ref: string, body: unknown) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: headers(s) })
const comment = (s: Session, ref: string, body: unknown) => postJson(`/api/v1/tickets/${ref}/comments`, body, headers(s))

async function deliveries(admin: Session, endpointId: string) {
  const res = await call(`/api/v1/webhooks/${endpointId}/deliveries`, { headers: headers(admin) })
  expect(res.status).toBe(200)
  return (await res.json() as { data: Delivery[] }).data
}

async function endpoint(admin: Session, id: string) {
  const { data } = await (await call('/api/v1/webhooks', { headers: headers(admin) })).json() as { data: Endpoint[] }
  return data.find(e => e.id === id)!
}

const to = (e: Endpoint) => (r: Received) => r.url === e.url

/** Standard Webhooks verification, written here from the spec and not taken from the server code. */
async function verify(secret: string, r: Received): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const content = `${r.headers.get('webhook-id')}.${r.headers.get('webhook-timestamp')}.${r.body}`
  return Promise.any((r.headers.get('webhook-signature') ?? '').split(' ').map(async (part) => {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) throw new Error('no v1 signature')
    if (!await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(sig), c => c.charCodeAt(0)), new TextEncoder().encode(content))) throw new Error('bad signature')
    return true
  })).catch(() => false)
}

describe('outbox: written with the change', () => {
  it('stores a ticket change and its Event together', async () => {
    const [requester, agent, admin] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    const t = await createTicket(requester)
    expect((await patch(agent, t.ref, { priority: 'high' })).status).toBe(200)
    const types = (await deliveries(admin, hook.id)).map(d => d.type).reverse()
    expect(types).toEqual(['ticket.created', 'ticket.updated'])
  })

  it('stores neither the change nor its audit entry when the Event cannot be written', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await createTicket(requester)
    const auditBefore = await env.DB.prepare('SELECT count(*) AS n FROM audit_log WHERE ticket_number = ?').bind(t.number).first<{ n: number }>()
    // Makes the outbox insert fail inside the batch.
    await env.DB.prepare(`CREATE TRIGGER outbox_fails BEFORE INSERT ON outbox_event BEGIN SELECT RAISE(ABORT, 'outbox down'); END`).run()
    try {
      const failed = await patch(agent, t.ref, { priority: 'urgent' })
      expect(failed.status).toBe(500)
      const after = await env.DB.prepare('SELECT priority FROM ticket WHERE number = ?').bind(t.number).first<{ priority: string }>()
      expect(after!.priority).toBe('normal')
      const auditAfter = await env.DB.prepare('SELECT count(*) AS n FROM audit_log WHERE ticket_number = ?').bind(t.number).first<{ n: number }>()
      expect(auditAfter!.n).toBe(auditBefore!.n)

      // The same for a new ticket and a comment.
      const before = await env.DB.prepare('SELECT count(*) AS n FROM ticket').first<{ n: number }>()
      const res = await postJson('/api/v1/tickets', { ticket_type_id: await typeId(requester.cookie, 'BUG'), title: 'X', fields: { page_or_feature: 'Reports' } }, headers(requester))
      expect(res.status).toBe(500)
      expect((await env.DB.prepare('SELECT count(*) AS n FROM ticket').first<{ n: number }>())!.n).toBe(before!.n)
      expect((await comment(agent, t.ref, { body: 'Lost?' })).status).toBe(500)
      expect((await env.DB.prepare('SELECT count(*) AS n FROM comment WHERE ticket_number = ?').bind(t.number).first<{ n: number }>())!.n).toBe(0)
    } finally {
      await env.DB.prepare('DROP TRIGGER outbox_fails').run()
    }
  })
})

describe('delivery', () => {
  it('names the Application as actor and the Contact as Requester', async () => {
    const admin = await signInAs('admin')
    const gen = await typeId(admin.cookie, 'GEN')
    const app = await (await postJson('/api/v1/applications', { name: `Shop ${crypto.randomUUID()}`, description: 'Test system.', permissions: ['tickets:create', 'tickets:read', 'comments:create'], ticket_type_ids: [gen] }, headers(admin))).json() as { id: number, name: string }
    const { key } = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'Test' }, headers(admin))).json() as { key: string }
    const hook = await addEndpoint(admin)
    const auth = { authorization: `Bearer ${key}` }
    const res = await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'Card declined', description: 'At checkout.', contact: { external_id: 'cus_9', name: 'Ana Lima', email: 'ana@shop.example' } }, auth)
    expect(res.status, await res.clone().text()).toBe(201)
    const t = await res.json() as { ref: string, number: number }
    expect((await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'More detail.' }, auth)).status).toBe(201)
    await runCron(Date.now())

    const got = receiver.requests.filter(to(hook)).map(r => r.payload as unknown as Record<string, unknown>)
    expect(got.map(p => p.type)).toEqual(['ticket.created', 'comment.created'])
    const actor = { kind: 'application', id: app.id, name: app.name, channel: 'api' }
    expect(got[0]).toMatchObject({ actor, after: { number: t.number, requester: { kind: 'contact', external_id: 'cus_9', name: 'Ana Lima', application_id: app.id } } })
    expect(got[1]).toMatchObject({ actor, comment: { visibility: 'public', author: { kind: 'application', id: app.id } } })
  })

  it('delivers a signed Event with before, after, changed and actor', async () => {
    const [requester, agent, admin] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    const t = await createTicket(requester)
    expect((await patch(agent, t.ref, { status: 'in_progress', assignee_id: agent.user.id, fields: { page_or_feature: 'Billing' } })).status).toBe(200)
    await runCron(Date.now())

    const got = receiver.requests.filter(to(hook))
    expect(got.map(r => r.payload.type)).toEqual(['ticket.created', 'ticket.updated'])
    for (const r of got) {
      expect(await verify(hook.secret, r)).toBe(true)
      expect(r.headers.get('webhook-id')).toBe(r.payload.event_id)
      expect(r.headers.get('content-type')).toBe('application/json')
    }

    const [created, updated] = got.map(r => r.payload) as [Payload, Payload]
    expect(created.before).toBeNull()
    expect(created.after).toMatchObject({ number: t.number, ref: t.ref, title: 'Export fails', status: { key: 'open', category: 'open' }, fields: { page_or_feature: 'Reports' } })
    expect(created.actor).toMatchObject({ kind: 'user', id: requester.user.id, channel: 'web' })

    expect(updated.changed.sort()).toEqual(['assignee', 'page_or_feature', 'status'])
    expect(updated.actor).toMatchObject({ kind: 'user', id: agent.user.id })
    expect(updated.before).toMatchObject({ number: t.number, ref: t.ref, status: { key: 'open' }, assignee: null, fields: { page_or_feature: 'Reports' } })
    expect(updated.after).toMatchObject({ number: t.number, ref: t.ref, status: { key: 'in_progress', category: 'active' }, assignee: { id: agent.user.id }, fields: { page_or_feature: 'Billing' } })
    // The same view as the REST API, so a receiver can use the same code for both.
    const rest = await (await call(`/api/v1/tickets/${t.ref}`, { headers: headers(agent) })).json() as TicketView
    expect(updated.after.updated_at).toBe(rest.updated_at)
    expect(updated.after.status).toEqual(rest.status)

    // Delivered once: the next run sends nothing.
    await runCron(Date.now() + MINUTE)
    expect(receiver.requests.filter(to(hook))).toHaveLength(2)
    expect((await deliveries(admin, hook.id)).map(d => d.state)).toEqual(['delivered', 'delivered'])
  })

  it('sends only the chosen events, and none to an endpoint that is off', async () => {
    const [requester, agent, admin] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const updatesOnly = await addEndpoint(admin, { events: ['ticket.updated'] })
    const off = await addEndpoint(admin)
    expect((await call(`/api/v1/webhooks/${off.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }), headers: headers(admin) })).status).toBe(200)
    const t = await createTicket(requester)
    await patch(agent, t.ref, { priority: 'high' })
    await runCron(Date.now())
    expect(receiver.requests.filter(to(updatesOnly)).map(r => r.payload.type)).toEqual(['ticket.updated'])
    expect(receiver.requests.filter(to(off))).toEqual([])
  })

  it('never sends Internal Comments to an endpoint without "include internal data"', async () => {
    const [requester, agent, admin] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const plain = await addEndpoint(admin)
    const internal = await addEndpoint(admin, { include_internal: true })
    expect(plain.include_internal).toBe(false)
    const t = await createTicket(requester)
    expect((await comment(agent, t.ref, { body: 'Secret note', visibility: 'internal' })).status).toBe(201)
    expect((await comment(agent, t.ref, { body: 'We are on it', visibility: 'public' })).status).toBe(201)
    await runCron(Date.now())

    const toPlain = receiver.requests.filter(to(plain))
    expect(toPlain.map(r => r.payload.comment?.body ?? null)).toEqual([null, 'We are on it'])
    expect(toPlain.map(r => r.body).join('\n')).not.toContain('Secret note')
    // The ticket view in the payload has no comments, and Fields have no visibility of their own (3.6).
    for (const r of toPlain) expect(Object.keys(r.payload.after)).not.toContain('comment_count')

    const toInternal = receiver.requests.filter(to(internal))
    expect(toInternal.map(r => r.payload.comment?.visibility ?? null)).toEqual([null, 'internal', 'public'])
    expect(toInternal[1]!.payload).toMatchObject({ type: 'comment.created', comment: { body: 'Secret note' }, after: { ref: t.ref } })
  })

  it('retries with backoff, gives up after 24 hours, and turns the endpoint off after 3 days', async () => {
    const [requester, agent, admin] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    receiver.status = 503
    const t = await createTicket(requester)
    const start = Date.now()

    // Follow the retry schedule that the endpoint shows, and check that nothing is sent before it.
    const attemptsAt: number[] = []
    let now = start
    for (let i = 0; i < 30; i++) {
      await runCron(now)
      attemptsAt.push(now)
      const [d] = await deliveries(admin, hook.id)
      if (d!.state !== 'pending') break
      const next = new Date(d!.next_attempt_at!).getTime()
      const sent = receiver.requests.length
      await runCron(next - 1000)
      expect(receiver.requests.length).toBe(sent)
      now = next
    }
    const [last] = await deliveries(admin, hook.id)
    expect(last!.state).toBe('failed')
    expect(last!.next_attempt_at).toBeNull()
    expect(receiver.requests.filter(to(hook))).toHaveLength(attemptsAt.length)
    expect(last!.attempts).toBe(attemptsAt.length)
    const gaps = attemptsAt.slice(1).map((at, i) => at - attemptsAt[i]!)
    expect(gaps[0]).toBe(MINUTE)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]!)
    expect(attemptsAt.at(-1)! - start).toBeLessThanOrEqual(DAY)
    expect(attemptsAt.at(-1)! - start).toBeGreaterThan(DAY - 7 * HOUR)
    // Every retry of the same Event has the same event_id.
    expect(new Set(receiver.requests.map(r => r.payload.event_id)).size).toBe(1)
    expect(new Set(receiver.requests.map(r => r.headers.get('webhook-id'))).size).toBe(1)

    const failing = await endpoint(admin, hook.id)
    expect(failing).toMatchObject({ status: 'failing', enabled: true, failures: attemptsAt.length, failing_since: new Date(start).toISOString(), next_attempt_at: null })

    // Still failing on day 2: the endpoint stays on.
    await patch(agent, t.ref, { priority: 'high' })
    await runCron(start + 2 * DAY)
    expect((await endpoint(admin, hook.id)).status).toBe('failing')

    // Three days after the first failure, the next failure turns it off.
    await patch(agent, t.ref, { priority: 'urgent' })
    await runCron(start + 3 * DAY)
    const off = await endpoint(admin, hook.id)
    expect(off).toMatchObject({ status: 'off', enabled: false, disabled_at: new Date(start + 3 * DAY).toISOString(), next_attempt_at: null })
    expect((await deliveries(admin, hook.id)).every(d => d.state !== 'pending')).toBe(true)
    // The Admins see it in the Inbox.
    const inbox = await (await call('/api/v1/notifications', { headers: { cookie: admin.cookie } })).json() as { data: { kind: string, href: string }[] }
    expect(inbox.data).toContainEqual(expect.objectContaining({ kind: 'webhook_disabled', href: '/webhooks' }))

    // Off: new Events do not go to it.
    const sent = receiver.requests.length
    await patch(agent, t.ref, { priority: 'low' })
    await runCron(start + 3 * DAY + MINUTE)
    expect(receiver.requests.length).toBe(sent)
  })

  it('a success clears the failure state', async () => {
    const [requester, admin] = await Promise.all([signInAs('requester'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    receiver.status = 500
    await createTicket(requester)
    const at = Date.now()
    await runCron(at)
    expect(await endpoint(admin, hook.id)).toMatchObject({ status: 'failing', next_attempt_at: new Date(at + MINUTE).toISOString(), last_delivery_at: null })
    receiver.status = 204
    await runCron(at + MINUTE)
    expect(await endpoint(admin, hook.id)).toMatchObject({ status: 'healthy', failing_since: null, failures: 0, next_attempt_at: null, last_delivery_at: new Date(at + MINUTE).toISOString() })
    const [d] = await deliveries(admin, hook.id)
    expect(d).toMatchObject({ state: 'delivered', attempts: 2, response_status: 204 })
  })

  it('a rotated secret signs the next delivery, and the old one no longer verifies', async () => {
    const [requester, admin] = await Promise.all([signInAs('requester'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    await createTicket(requester)
    await runCron(Date.now())

    const res = await postJson(`/api/v1/webhooks/${hook.id}/rotate-secret`, {}, headers(admin))
    expect(res.status).toBe(200)
    const { secret } = await res.json() as { secret: string }
    expect(secret).toMatch(/^whsec_/)
    expect(secret).not.toBe(hook.secret)
    await createTicket(requester)
    await runCron(Date.now())

    const [first, second] = receiver.requests.filter(to(hook))
    expect(await verify(hook.secret, first!)).toBe(true)
    expect(await verify(hook.secret, second!)).toBe(false)
    expect(await verify(secret, second!)).toBe(true)
  })

  it('shows the secret only on create and rotate, and stores it encrypted', async () => {
    const admin = await signInAs('admin')
    const hook = await addEndpoint(admin)
    const listed = await (await call('/api/v1/webhooks', { headers: headers(admin) })).text()
    expect(listed).not.toContain(hook.secret)
    expect(listed).not.toContain('"secret"')
    const stored = await env.DB.prepare('SELECT secret FROM webhook_endpoint WHERE id = ?').bind(hook.id).first<{ secret: string }>()
    expect(stored!.secret).not.toContain(hook.secret.slice(6))
  })

  it('"Send test event" and "Retry now" send at once', async () => {
    const [requester, admin] = await Promise.all([signInAs('requester'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    const test = await postJson(`/api/v1/webhooks/${hook.id}/test`, {}, headers(admin))
    expect(test.status).toBe(200)
    expect(await test.json()).toMatchObject({ type: 'webhook.test', state: 'delivered', response_status: 200 })
    expect(await verify(hook.secret, receiver.requests[0]!)).toBe(true)

    receiver.status = 502
    await createTicket(requester)
    await runCron(Date.now())
    expect((await endpoint(admin, hook.id)).status).toBe('failing')
    receiver.status = 200
    const retried = await postJson(`/api/v1/webhooks/${hook.id}/retry`, {}, headers(admin))
    expect(retried.status).toBe(200)
    expect(await retried.json()).toMatchObject({ status: 'healthy', next_attempt_at: null })
    const created = receiver.requests.filter(r => r.payload.type === 'ticket.created')
    expect(created).toHaveLength(2)
    expect(created[0]!.payload.event_id).toBe(created[1]!.payload.event_id)
  })

  it('the delivery log has the exact payload that was signed', async () => {
    const [requester, admin] = await Promise.all([signInAs('requester'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    const t = await createTicket(requester)
    await runCron(Date.now())
    const [d] = await deliveries(admin, hook.id)
    expect(d).toMatchObject({ type: 'ticket.created', ticket_ref: t.ref, attempts: 1, response_status: 200 })
    const one = await (await call(`/api/v1/webhooks/${hook.id}/deliveries/${d!.id}`, { headers: headers(admin) })).json() as { payload: string }
    expect(one.payload).toBe(receiver.requests[0]!.body)
  })

  it('purges Events and deliveries after 30 days', async () => {
    const [requester, admin] = await Promise.all([signInAs('requester'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    await createTicket(requester)
    await runCron(Date.now())
    await runCron(Date.now() + 29 * DAY)
    expect(await deliveries(admin, hook.id)).toHaveLength(1)
    await runCron(Date.now() + 31 * DAY)
    expect(await deliveries(admin, hook.id)).toHaveLength(0)
    expect((await env.DB.prepare('SELECT count(*) AS n FROM outbox_event').first<{ n: number }>())!.n).toBe(0)
  })
})

describe('admin endpoints', () => {
  it('only Admins can see or change endpoints', async () => {
    const [agent, admin] = await Promise.all([signInAs('agent'), signInAs('admin')])
    const hook = await addEndpoint(admin)
    expect((await call('/api/v1/webhooks', { headers: headers(agent) })).status).toBe(403)
    expect((await postJson('/api/v1/webhooks', { name: 'x', url: 'https://example.com/h' }, headers(agent))).status).toBe(403)
    expect((await postJson(`/api/v1/webhooks/${hook.id}/rotate-secret`, {}, headers(agent))).status).toBe(403)
    expect((await call('/api/v1/webhooks')).status).toBe(401)
  })

  it.each([
    ['http://hooks.example.com/x', 'https'],
    ['https://localhost/x', 'public'],
    ['https://127.0.0.1/x', 'public'],
    ['https://2130706433/x', 'public'],
    ['https://10.1.2.3/x', 'public'],
    ['https://172.20.0.1/x', 'public'],
    ['https://192.168.1.10/x', 'public'],
    ['https://169.254.169.254/latest/meta-data', 'public'],
    ['https://[::1]/x', 'public'],
    ['https://[fe80::1]/x', 'public'],
    ['https://[fd00::1]/x', 'public'],
    ['https://[::ffff:127.0.0.1]/x', 'public'],
    ['https://printer.local/x', 'public'],
    ['https://metadata.google.internal/x', 'public'],
    ['https://user:pass@hooks.example.com/x', 'user name'],
    ['not a url', 'absolute'],
  ])('refuses the endpoint URL %s', async (url, reason) => {
    const admin = await signInAs('admin')
    const res = await postJson('/api/v1/webhooks', { name: 'Bad', url }, headers(admin))
    expect(res.status).toBe(422)
    const { error } = await res.json() as { error: { details: { key: string, reason: string }[] } }
    expect(error.details[0]!.key).toBe('url')
    expect(error.details[0]!.reason).toContain(reason)
  })

  it('validates events and refuses unknown keys', async () => {
    const admin = await signInAs('admin')
    expect((await postJson('/api/v1/webhooks', { name: 'x', url: 'https://hooks.example.com/x', events: [] }, headers(admin))).status).toBe(422)
    expect((await postJson('/api/v1/webhooks', { name: 'x', url: 'https://hooks.example.com/x', events: ['ticket.deleted'] }, headers(admin))).status).toBe(422)
    expect((await postJson('/api/v1/webhooks', { name: 'x', url: 'https://hooks.example.com/x', secret: 'mine' }, headers(admin))).status).toBe(422)
    const hook = await addEndpoint(admin, { events: ['comment.created', 'ticket.created', 'comment.created'] })
    expect(hook.events).toEqual(['ticket.created', 'comment.created'])
  })

  it('edits and deletes an endpoint', async () => {
    const admin = await signInAs('admin')
    const hook = await addEndpoint(admin)
    const res = await call(`/api/v1/webhooks/${hook.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Slack', include_internal: true }), headers: headers(admin) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'Slack', include_internal: true, url: hook.url })
    expect((await call(`/api/v1/webhooks/${hook.id}`, { method: 'DELETE', headers: headers(admin) })).status).toBe(204)
    expect((await call(`/api/v1/webhooks/${hook.id}`, { method: 'DELETE', headers: headers(admin) })).status).toBe(404)
  })
})
