import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, postJson, signInAs, typeId } from './helpers'
// @ts-expect-error The build output has no types.
import builtWorker from '../../.output/server/index.mjs'

const built = builtWorker as ExportedHandler<Cloudflare.Env>

type Session = Awaited<ReturnType<typeof signInAs>>
interface Hook { id: string, url: string, events: string[], include_internal: boolean, status: string, secret?: string }
interface Received { url: string, headers: Headers, body: string, payload: Record<string, any> }
interface Ticket { number: number, ref: string }

const headers = (s: Session) => ({ cookie: s.cookie })
const receiver = { status: 200, requests: [] as Received[] }

beforeEach(async () => {
  await env.DB.batch(['DELETE FROM webhook_delivery', 'DELETE FROM outbox_event', 'DELETE FROM webhook_endpoint'].map(q => env.DB.prepare(q)))
  receiver.status = 200
  receiver.requests = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init)
    if (!request.url.startsWith('https://hooks.test-receiver.com/')) return real(input as RequestInfo, init)
    const body = await request.text()
    receiver.requests.push({ url: request.url, headers: request.headers, body, payload: JSON.parse(body) })
    return new Response(null, { status: receiver.status })
  })
})

afterEach(() => vi.restoreAllMocks())

async function runCron(at: number) {
  const ctx = createExecutionContext()
  await built.scheduled!(createScheduledController({ scheduledTime: at, cron: '* * * * *' }), env, ctx)
  await waitOnExecutionContext(ctx)
}

async function newApplication(admin: Session) {
  const gen = await typeId(admin.cookie, 'GEN')
  const app = await (await postJson('/api/v1/applications', { name: `Shop ${crypto.randomUUID()}`, description: '', permissions: ['tickets:create', 'tickets:read', 'comments:create'], ticket_type_ids: [gen] }, headers(admin))).json() as { id: number }
  const { key } = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'Test' }, headers(admin))).json() as { key: string }
  return { id: app.id, gen, auth: { authorization: `Bearer ${key}` } }
}

type App = Awaited<ReturnType<typeof newApplication>>

async function addHook(admin: Session, app: App, url = `https://hooks.test-receiver.com/${crypto.randomUUID()}`) {
  const res = await postJson(`/api/v1/applications/${app.id}/webhook`, { url }, headers(admin))
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Hook & { secret: string }
}

async function appTicket(app: App): Promise<Ticket> {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: app.gen, title: 'Card declined', contact: { external_id: 'cus_1', name: 'Ana Lima', email: 'ana@shop.example' } }, app.auth)
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Ticket
}

const toHook = (h: Hook) => (r: Received) => r.url === h.url

async function verify(secret: string, r: Received): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const content = `${r.headers.get('webhook-id')}.${r.headers.get('webhook-timestamp')}.${r.body}`
  const sig = (r.headers.get('webhook-signature') ?? '').split(',')[1] ?? ''
  return crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(sig), c => c.charCodeAt(0)), new TextEncoder().encode(content))
}

describe('Application Webhook Endpoint: what it receives', () => {
  it('never gets an Event about another Application\'s ticket or an internal ticket', async () => {
    const [admin, requester] = await Promise.all([signInAs('admin'), signInAs('requester')])
    const [a, b] = [await newApplication(admin), await newApplication(admin)]
    const hookA = await addHook(admin, a)
    const hookB = await addHook(admin, b)
    const own = await appTicket(a)
    const other = await appTicket(b)
    const internal = await (await postJson('/api/v1/tickets', { ticket_type_id: await typeId(requester.cookie, 'BUG'), title: 'Internal', fields: { page_or_feature: 'Reports' } }, headers(requester))).json() as Ticket
    await runCron(Date.now())

    const toA = receiver.requests.filter(toHook(hookA))
    expect(toA).toHaveLength(1)
    expect(toA[0]!.payload).toMatchObject({ type: 'ticket.created', after: { number: own.number, ref: own.ref } })
    expect(toA[0]!.payload.after.number).not.toBe(other.number)
    expect(await verify(hookA.secret, toA[0]!)).toBe(true)
    const toB = receiver.requests.filter(toHook(hookB))
    expect(toB.map(r => r.payload.after.number)).toEqual([other.number])
    expect(receiver.requests.some(r => r.body.includes(`"number":${internal.number},`))).toBe(false)
  })

  it('sends a Public Comment as comment.created and nothing for an Internal Comment', async () => {
    const [admin, agent] = await Promise.all([signInAs('admin'), signInAs('agent')])
    const app = await newApplication(admin)
    const hook = await addHook(admin, app)
    const t = await appTicket(app)
    const post = (body: unknown) => postJson(`/api/v1/tickets/${t.ref}/comments`, body, headers(agent))
    expect((await post({ body: 'Secret note', visibility: 'internal' })).status).toBe(201)
    expect((await post({ body: 'We are on it', visibility: 'public' })).status).toBe(201)
    await runCron(Date.now())

    const got = receiver.requests.filter(toHook(hook))
    expect(got.map(r => r.payload.type)).toEqual(['ticket.created', 'comment.created'])
    expect(got[1]!.payload.comment).toMatchObject({ visibility: 'public', body: 'We are on it' })
    expect(got.map(r => r.body).join('\n')).not.toContain('Secret note')
  })

  it('ignores stored events and include_internal that an Admin could not set through the API', async () => {
    const [admin, agent] = await Promise.all([signInAs('admin'), signInAs('agent')])
    const app = await newApplication(admin)
    const hook = await addHook(admin, app)
    await env.DB.prepare(`UPDATE webhook_endpoint SET include_internal = 1, events = '["ticket.created","ticket.updated","comment.created","webhook.test"]' WHERE id = ?`).bind(hook.id).run()
    const t = await appTicket(app)
    await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Secret note', visibility: 'internal' }, headers(agent))
    await runCron(Date.now())
    const got = receiver.requests.filter(toHook(hook))
    expect(got.map(r => r.payload.type)).toEqual(['ticket.created'])
    expect(got[0]!.body).not.toContain('Secret note')
  })

  it('has no staff email in the payload, while the Admin endpoint keeps it', async () => {
    const [admin, agent] = await Promise.all([signInAs('admin'), signInAs('agent')])
    const app = await newApplication(admin)
    const hook = await addHook(admin, app)
    const adminHook = (await (await postJson('/api/v1/webhooks', { name: 'Team', url: `https://hooks.test-receiver.com/${crypto.randomUUID()}` }, headers(admin))).json()) as Hook
    const t = await appTicket(app)
    expect((await call(`/api/v1/tickets/${t.ref}`, { method: 'PATCH', body: JSON.stringify({ assignee_id: agent.user.id }), headers: headers(agent) })).status).toBe(200)
    await runCron(Date.now())

    const update = receiver.requests.filter(toHook(hook)).find(r => r.payload.type === 'ticket.updated')!
    expect(update.payload.after.assignee).toEqual({ id: agent.user.id, name: agent.user.name })
    expect(update.body).not.toContain(agent.user.email)
    expect(await verify(hook.secret, update)).toBe(true)
    const full = receiver.requests.filter(toHook(adminHook)).find(r => r.payload.type === 'ticket.updated' && r.payload.after.number === t.number)!
    expect(full.payload.after.assignee.email).toBe(agent.user.email)
  })
})

describe('Application Webhook Endpoint: management', () => {
  it('refuses other events and "include internal data" (422), and a second endpoint (409)', async () => {
    const admin = await signInAs('admin')
    const app = await newApplication(admin)
    const url = 'https://hooks.test-receiver.com/x'
    const path = `/api/v1/applications/${app.id}/webhook`
    for (const extra of [{ events: ['ticket.created'] }, { include_internal: true }, { name: 'Mine' }]) {
      expect((await postJson(path, { url, ...extra }, headers(admin))).status, JSON.stringify(extra)).toBe(422)
    }
    const hook = await addHook(admin, app)
    expect((await postJson(path, { url }, headers(admin))).status).toBe(409)
    for (const bad of [{ events: ['ticket.updated'] }, { include_internal: true }]) {
      expect((await call(path, { method: 'PATCH', body: JSON.stringify(bad), headers: headers(admin) })).status).toBe(422)
    }
    // Repeating the fixed values is fine.
    const ok = await call(path, { method: 'PATCH', body: JSON.stringify({ events: hook.events, include_internal: false, url: 'https://hooks.test-receiver.com/y' }), headers: headers(admin) })
    expect(ok.status).toBe(200)
    expect((await ok.json() as Hook).url).toBe('https://hooks.test-receiver.com/y')
  })

  it('is for Admins only, and the Admin Webhooks routes do not see it', async () => {
    const [admin, agent] = await Promise.all([signInAs('admin'), signInAs('agent')])
    const app = await newApplication(admin)
    const hook = await addHook(admin, app)
    const path = `/api/v1/applications/${app.id}/webhook`
    expect((await call(path, { headers: headers(agent) })).status).toBe(403)
    expect((await call(path, { headers: app.auth })).status).toBe(403)
    expect((await call(path)).status).toBe(401)
    const { data } = await (await call('/api/v1/webhooks', { headers: headers(admin) })).json() as { data: Hook[] }
    expect(data.find(e => e.id === hook.id)).toBeUndefined()
    for (const [p, method] of [[`/api/v1/webhooks/${hook.id}`, 'PATCH'], [`/api/v1/webhooks/${hook.id}/rotate-secret`, 'POST'], [`/api/v1/webhooks/${hook.id}/test`, 'POST'], [`/api/v1/webhooks/${hook.id}/deliveries`, 'GET']] as const) {
      expect((await call(p, { method, body: method === 'PATCH' ? '{}' : undefined, headers: headers(admin) })).status, p).toBe(404)
    }
    expect((await call(`/api/v1/applications/999999/webhook`, { headers: headers(admin) })).status).toBe(404)
  })

  it('rotates the secret, sends a test event, lists deliveries and retries', async () => {
    const admin = await signInAs('admin')
    const app = await newApplication(admin)
    const hook = await addHook(admin, app)
    const path = `/api/v1/applications/${app.id}/webhook`
    expect((await (await call(path, { headers: headers(admin) })).json() as { data: Hook }).data).not.toHaveProperty('secret')

    const rotated = await (await postJson(`${path}/rotate-secret`, {}, headers(admin))).json() as Hook & { secret: string }
    expect(rotated.secret).not.toBe(hook.secret)

    receiver.status = 500
    const failed = await (await postJson(`${path}/test`, {}, headers(admin))).json() as { state: string, type: string }
    expect(failed).toMatchObject({ state: 'pending', type: 'webhook.test' })
    receiver.status = 200
    const retried = await (await postJson(`${path}/retry`, {}, headers(admin))).json() as Hook
    expect(retried.status).toBe('healthy')
    const last = receiver.requests.at(-1)!
    expect(await verify(rotated.secret, last)).toBe(true)
    expect(await verify(hook.secret, last)).toBe(false)

    const { data } = await (await call(`${path}/deliveries`, { headers: headers(admin) })).json() as { data: { id: number, state: string }[] }
    expect(data.map(d => d.state)).toEqual(['delivered'])
    const one = await (await call(`${path}/deliveries/${data[0]!.id}`, { headers: headers(admin) })).json() as { payload: string }
    expect(JSON.parse(one.payload).type).toBe('webhook.test')
  })

  it('stores owner and application_id together (CHECK) and deletes the endpoint', async () => {
    const admin = await signInAs('admin')
    const app = await newApplication(admin)
    const hook = await addHook(admin, app)
    const insert = (owner: string, applicationId: number | null) => env.DB.prepare(`INSERT INTO webhook_endpoint (id, owner, application_id, name, url, events, secret, created_at) VALUES (?, ?, ?, 'n', 'https://x.example', '[]', 's', 1)`).bind(crypto.randomUUID(), owner, applicationId).run()
    await expect(insert('application', null)).rejects.toThrow()
    await expect(insert('admin', app.id)).rejects.toThrow()
    await expect(insert('application', app.id)).rejects.toThrow() // unique per Application
    expect((await call(`/api/v1/applications/${app.id}/webhook`, { method: 'DELETE', headers: headers(admin) })).status).toBe(204)
    expect(await env.DB.prepare('SELECT 1 FROM webhook_endpoint WHERE id = ?').bind(hook.id).first()).toBeNull()
    expect((await call(`/api/v1/applications/${app.id}/webhook`, { headers: headers(admin) })).status).toBe(200)
  })
})
