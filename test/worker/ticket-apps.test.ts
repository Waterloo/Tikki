import { env } from 'cloudflare:workers'
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { appUrlProblem } from '../../server/utils/ticket-apps'
import { adminAuditOf, BASE, call, createRestrictedType, getMcpToken, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>
interface App { id: number, name: string, url: string, position: 'sidebar' | 'tab', ticket_type_ids: number[] | null, enabled: boolean }
interface Ticket { number: number, ref: string }
interface TokenAnswer { token: string, expires_at: string, data: Record<string, any> }

const APP_ORIGIN = 'http://localhost:9934'
const h = (s: Session) => ({ cookie: s.cookie })
const patchApp = (s: Session, id: number, body: unknown) => call(`/api/v1/admin/ticket-apps/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: h(s) })
const token = (s: Session | null, ref: string, appId: number, headers: HeadersInit = {}) =>
  call(`/api/v1/tickets/${ref}/apps/${appId}/token`, { method: 'POST', headers: { ...(s ? h(s) : {}), ...headers } })

let admin: Session
let agent: Session
let requester: Session
let gen: number
let bug: number
let counter = 0

beforeAll(async () => {
  ;[admin, agent, requester] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('requester')])
  ;[gen, bug] = await Promise.all([typeId(admin.cookie, 'GEN'), typeId(admin.cookie, 'BUG')])
})

async function newApp(body: Record<string, unknown> = {}): Promise<App> {
  const res = await postJson('/api/v1/admin/ticket-apps', { name: `Orders ${counter++}`, url: `${APP_ORIGIN}/app.html`, position: 'sidebar', ...body }, h(admin))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<App>
}

async function raise(s: Session, ticketTypeId = gen): Promise<Ticket> {
  const fields = ticketTypeId === bug ? { page_or_feature: 'Reports' } : {}
  const res = await postJson('/api/v1/tickets', { ticket_type_id: ticketTypeId, title: `Charged twice ${counter++}`, description: 'Order 5521.', fields }, h(s))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<Ticket>
}

async function jwks() {
  return createLocalJWKSet(await (await call('/api/auth/jwks')).json() as Parameters<typeof createLocalJWKSet>[0])
}

describe('Ticket Apps: admin', () => {
  it('lets an Admin create, change, move, turn off and delete an app, with an audit entry for each', async () => {
    const app = await newApp({ ticket_type_ids: [gen, gen] })
    expect(app).toMatchObject({ position: 'sidebar', ticket_type_ids: [gen], enabled: true })

    const changed = await patchApp(admin, app.id, { name: 'Orders panel', ticket_type_ids: null })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ name: 'Orders panel', ticket_type_ids: null })
    expect((await patchApp(admin, app.id, { enabled: false })).status).toBe(200)

    const second = await newApp()
    const moved = await postJson(`/api/v1/admin/ticket-apps/${second.id}/move`, { direction: 'up' }, h(admin))
    expect(moved.status).toBe(200)
    const order = ((await moved.json()) as { data: App[] }).data.map(a => a.id)
    expect(order.indexOf(second.id)).toBeLessThan(order.indexOf(app.id))

    expect((await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'DELETE', headers: h(admin) })).status).toBe(204)
    const list = await (await call('/api/v1/admin/ticket-apps', { headers: h(admin) })).json() as { data: App[] }
    expect(list.data.some(a => a.id === app.id)).toBe(false)

    const entries = await adminAuditOf('ticket_app', app.id)
    expect(entries.map(e => e.action)).toEqual(['ticket_app_created', 'ticket_app_changed', 'ticket_app_disabled', 'ticket_app_deleted'])
    expect(entries.every(e => e.principal_id === admin.user.id)).toBe(true)
    expect(entries[1]).toMatchObject({ before: { name: app.name, ticket_type_ids: [gen] }, after: { name: 'Orders panel', ticket_type_ids: null } })
    expect((await adminAuditOf('ticket_app', second.id)).map(e => e.action)).toEqual(['ticket_app_created', 'ticket_app_moved'])
  })

  it('refuses Agents and Requesters with 403', async () => {
    const app = await newApp()
    for (const s of [agent, requester]) {
      expect((await call('/api/v1/admin/ticket-apps', { headers: h(s) })).status).toBe(403)
      expect((await postJson('/api/v1/admin/ticket-apps', { name: 'X', url: `${APP_ORIGIN}/`, position: 'tab' }, h(s))).status).toBe(403)
      expect((await patchApp(s, app.id, { enabled: false })).status).toBe(403)
      expect((await postJson(`/api/v1/admin/ticket-apps/${app.id}/move`, { direction: 'up' }, h(s))).status).toBe(403)
      expect((await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'DELETE', headers: h(s) })).status).toBe(403)
    }
    expect((await adminAuditOf('ticket_app', app.id)).map(e => e.action)).toEqual(['ticket_app_created'])
  })

  it('answers 422 for a bad URL, an empty type list, and an unknown or archived type', async () => {
    const bad = async (body: Record<string, unknown>) => {
      const res = await postJson('/api/v1/admin/ticket-apps', { name: 'Orders', url: 'https://orders.example.com/', position: 'sidebar', ...body }, h(admin))
      expect(res.status, JSON.stringify(body)).toBe(422)
      return JSON.stringify(await res.json())
    }
    expect(await bad({ url: 'http://orders.example.com/' })).toContain('Must use https.')
    expect(await bad({ url: 'orders' })).toContain('absolute URL')
    expect(await bad({ url: `${BASE}/evil` })).toContain('another origin')
    expect(await bad({ url: 'https://user:pw@orders.example.com/' })).toContain('user name')
    expect(await bad({ ticket_type_ids: [] })).toContain('at least one')
    expect(await bad({ ticket_type_ids: [999999] })).toContain('ticket_type_ids')
    expect(await bad({ position: 'footer' })).toContain('position')

    const archived = await createRestrictedType()
    await env.DB.prepare('UPDATE ticket_type SET archived_at = ? WHERE id = ?').bind(Date.now(), archived).run()
    expect(await bad({ ticket_type_ids: [archived] })).toContain('archived')
  })

  it('allows http://localhost only on a development or test instance', () => {
    const tikki = 'https://tikki.example.com'
    for (const env of ['staging', 'production'] as const) {
      expect(appUrlProblem('http://localhost:5173/', env, tikki)).toBe('Must use https.')
      expect(appUrlProblem('http://127.0.0.1:5173/', env, tikki)).toBe('Must use https.')
    }
    expect(appUrlProblem('http://localhost:5173/', 'development', tikki)).toBeNull()
    expect(appUrlProblem('http://localhost:5173/', 'test', tikki)).toBeNull()
    expect(appUrlProblem('https://orders.example.com/', 'production', tikki)).toBeNull()
  })

  it('drops an archived type out of the list and off its tickets', async () => {
    const type = await createRestrictedType()
    const app = await newApp({ ticket_type_ids: [type, gen] })
    await env.DB.prepare('UPDATE ticket_type SET archived_at = ? WHERE id = ?').bind(Date.now(), type).run()
    const list = await (await call('/api/v1/admin/ticket-apps', { headers: h(admin) })).json() as { data: App[] }
    expect(list.data.find(a => a.id === app.id)?.ticket_type_ids).toEqual([gen])
  })
})

describe('Ticket Apps: the token route', () => {
  it('gives a token and the context to an Agent who can read the ticket, and records nothing', async () => {
    const app = await newApp()
    const t = await raise(requester)
    const before = (await env.DB.prepare('SELECT count(*) AS n FROM audit_log').first<{ n: number }>())!.n
    const res = await token(agent, t.ref, app.id)
    expect(res.status, await res.clone().text()).toBe(200)
    const body = await res.json() as TokenAnswer
    expect(body.data).toMatchObject({
      version: 1,
      app: { id: app.id, name: app.name, position: 'sidebar' },
      agent: { id: agent.user.id, role: 'agent' },
      ticket: { ref: t.ref, number: t.number, url: `${BASE}/tickets/${t.ref}`, ticket_type: { id: gen } },
      requester: { kind: 'user', id: requester.user.id },
    })
    expect(Object.keys(body.data).sort()).toEqual(['agent', 'app', 'requester', 'ticket', 'version'])
    expect(body.data.ticket).not.toHaveProperty('comment_count')
    expect(body.data.ticket).not.toHaveProperty('allowed_actions')
    expect((await env.DB.prepare('SELECT count(*) AS n FROM audit_log').first<{ n: number }>())!.n).toBe(before)
  })

  it('answers 401 without a session, 403 to a Requester and an API key, 404 for an unreadable ticket', async () => {
    const app = await newApp()
    const mine = await raise(requester)
    expect((await token(null, mine.ref, app.id)).status).toBe(401)
    // Their own ticket, which they can read.
    expect((await token(requester, mine.ref, app.id)).status).toBe(403)

    const created = await postJson('/api/v1/applications', { name: `Shop ${counter++}`, description: 'Shop.', permissions: ['tickets:read'], ticket_type_ids: [gen] }, h(admin))
    const key = await (await postJson(`/api/v1/applications/${(await created.json() as { id: number }).id}/keys`, { name: 'Prod' }, h(admin))).json() as { key: string }
    expect((await token(null, mine.ref, app.id, { authorization: `Bearer ${key.key}` })).status).toBe(403)
    // A cookie does not help a request that also sends a key.
    expect((await token(agent, mine.ref, app.id, { authorization: `Bearer ${key.key}` })).status).toBe(403)

    const restricted = await raise(admin, await createRestrictedType())
    expect((await token(agent, restricted.ref, app.id)).status).toBe(404)
    expect((await token(agent, 'GEN-999999', app.id)).status).toBe(404)
  })

  it('answers 404 for an app that is off, deleted, or not shown on the ticket type', async () => {
    const t = await raise(requester)
    const off = await newApp({ enabled: false })
    expect((await token(agent, t.ref, off.id)).status).toBe(404)
    const bugOnly = await newApp({ ticket_type_ids: [bug] })
    expect((await token(agent, t.ref, bugOnly.id)).status).toBe(404)
    expect((await token(agent, (await raise(requester, bug)).ref, bugOnly.id)).status).toBe(200)
    const gone = await newApp()
    await call(`/api/v1/admin/ticket-apps/${gone.id}`, { method: 'DELETE', headers: h(admin) })
    expect((await token(agent, t.ref, gone.id)).status).toBe(404)
  })

  it('signs a token that checks against the JWKS with the right claims, and that /mcp refuses', async () => {
    const app = await newApp({ url: `${APP_ORIGIN}/orders/index.html?x=1` })
    const t = await raise(requester)
    const now = Math.floor(Date.now() / 1000)
    const { token: jwt, expires_at } = await (await token(agent, t.ref, app.id)).json() as TokenAnswer

    const { payload } = await jwtVerify(jwt, await jwks(), { issuer: `${BASE}/api/auth`, audience: APP_ORIGIN })
    expect(payload).toMatchObject({ sub: agent.user.id, tikki_app: app.id, tikki_ticket: t.ref, tikki_scope: 'read' })
    expect(payload.exp! - payload.iat!).toBe(300)
    expect(Math.abs(payload.iat! - now)).toBeLessThan(10)
    expect(new Date(expires_at).getTime()).toBe(payload.exp! * 1000)
    await expect(jwtVerify(jwt, await jwks(), { issuer: `${BASE}/api/auth`, audience: 'http://localhost:9935' })).rejects.toThrow()

    const list = { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), headers: { accept: 'application/json, text/event-stream' } }
    const refused = await call('/mcp', { ...list, headers: { ...list.headers, authorization: `Bearer ${jwt}` } })
    expect(refused.status).toBe(401)
    // The same request with an MCP access token passes, so the 401 is the audience check.
    const mcp = await getMcpToken(agent.cookie)
    expect(decodeJwt(mcp.access_token).aud).not.toBe(APP_ORIGIN)
    expect((await call('/mcp', { ...list, headers: { ...list.headers, authorization: `Bearer ${mcp.access_token}` } })).status).toBe(200)
    // The other Bearer verifiers refuse it too. Issue 35 opens the REST API to it.
    for (const path of ['/api/auth/oauth2/userinfo', `/api/v1/tickets/${t.ref}`]) {
      expect((await call(path, { headers: { authorization: `Bearer ${jwt}` } })).status, path).toBe(401)
    }
  })

  it('gives a token on a Restricted ticket only to its Participants and Admins', async () => {
    const app = await newApp()
    const [owner, outsider, participant] = await Promise.all([signInAs('agent'), signInAs('agent'), signInAs('agent')])
    const t = await raise(owner, await createRestrictedType())
    expect((await postJson(`/api/v1/tickets/${t.ref}/participants`, { user_id: participant.user.id }, h(owner))).status).toBe(201)
    expect((await token(owner, t.ref, app.id)).status).toBe(200)
    expect((await token(participant, t.ref, app.id)).status).toBe(200)
    expect((await token(admin, t.ref, app.id)).status).toBe(200)
    expect((await token(outsider, t.ref, app.id)).status).toBe(404)
  })
})

describe('Ticket Apps: the list on a ticket', () => {
  it('shows staff the apps that are on and match the type, in the admin order; Requesters get 403', async () => {
    const t = await raise(requester)
    const shown = await newApp({ position: 'tab' })
    const off = await newApp({ enabled: false })
    const bugOnly = await newApp({ ticket_type_ids: [bug] })
    const res = await call(`/api/v1/tickets/${t.ref}/apps`, { headers: h(agent) })
    expect(res.status).toBe(200)
    const ids = ((await res.json()) as { data: App[] }).data.map(a => a.id)
    expect(ids).toContain(shown.id)
    expect(ids).not.toContain(off.id)
    expect(ids).not.toContain(bugOnly.id)
    expect((await call(`/api/v1/tickets/${t.ref}/apps`, { headers: h(requester) })).status).toBe(403)
    expect((await call(`/api/v1/tickets/${t.ref}/apps`)).status).toBe(401)
  })
})
