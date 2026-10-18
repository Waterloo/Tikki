import { decodeJwt } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { useAuth } from '../../server/utils/services'
import { adminAuditOf, call, postJson, signInAs, typeId } from './helpers'

// Issue 39: app pages in the Apps menu, and a page token that proves who the User is and nothing more (ADR 0005).

type Session = Awaited<ReturnType<typeof signInAs>>
interface App { id: number, name: string, page_for_requesters: boolean }
interface Ticket { number: number, ref: string }
interface PageAnswer { token: string, expires_at: string, data: Record<string, unknown> }

const PAGE_ORIGIN = 'http://localhost:9939'
const SIDEBAR_ORIGIN = 'http://127.0.0.1:9940'
const h = (s: Session) => ({ cookie: s.cookie })
const bearer = (jwt: string) => ({ authorization: `Bearer ${jwt}` })

let admin: Session
let agent: Session
let requester: Session
let gen: number
let counter = 0

beforeAll(async () => {
  ;[admin, agent, requester] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('requester')])
  gen = await typeId(admin.cookie, 'GEN')
})

async function newApp(body: Record<string, unknown>): Promise<App> {
  const res = await postJson('/api/v1/admin/ticket-apps', { name: `Timesheet ${counter++}`, ...body }, h(admin))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<App>
}

const pageApp = (body: Record<string, unknown> = {}) => newApp({ page_url: `${PAGE_ORIGIN}/page.html?view=week`, ...body })
const patchApp = (id: number, body: unknown) => call(`/api/v1/admin/ticket-apps/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: h(admin) })
const tokenRes = (s: Session, appId: number, headers: Record<string, string> = {}) => call(`/api/v1/apps/${appId}/token`, { method: 'POST', headers: { ...h(s), ...headers } })

async function pageToken(s: Session, appId: number): Promise<PageAnswer> {
  const res = await tokenRes(s, appId)
  expect(res.status, await res.clone().text()).toBe(200)
  return res.json() as Promise<PageAnswer>
}

async function menu(s: Session): Promise<{ id: number, name: string, url: string }[]> {
  const res = await call('/api/v1/apps', { headers: h(s) })
  expect(res.status, await res.clone().text()).toBe(200)
  return ((await res.json()) as { data: { id: number, name: string, url: string }[] }).data
}

async function raise(s: Session): Promise<Ticket> {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: gen, title: `Log time ${counter++}`, description: 'Two hours.' }, h(s))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<Ticket>
}

describe('App pages: token route', () => {
  it('gives a page token to an Agent and an Admin, and to a Requester only when the page shows to Requesters', async () => {
    const app = await pageApp()
    await pageToken(agent, app.id)
    await pageToken(admin, app.id)
    expect((await tokenRes(requester, app.id)).status).toBe(404)

    expect((await patchApp(app.id, { page_for_requesters: true })).status).toBe(200)
    const answer = await pageToken(requester, app.id)
    expect(decodeJwt(answer.token)).toMatchObject({ sub: requester.user.id, tikki_role: 'requester' })

    expect((await patchApp(app.id, { page_for_requesters: false })).status).toBe(200)
    expect((await tokenRes(requester, app.id)).status).toBe(404)
  })

  it('answers 404 for an app without a page URL, an app that is off, and an unknown app', async () => {
    const sidebarOnly = await newApp({ sidebar_url: `${SIDEBAR_ORIGIN}/card.html` })
    expect((await tokenRes(agent, sidebarOnly.id)).status).toBe(404)
    const off = await pageApp({ enabled: false })
    expect((await tokenRes(agent, off.id)).status).toBe(404)
    expect((await tokenRes(agent, 999_999)).status).toBe(404)
    expect((await tokenRes(agent, 'abc' as unknown as number)).status).toBe(404)
  })

  it('answers 403 to any Authorization header, also with a session cookie', async () => {
    const app = await pageApp()
    const { token } = await pageToken(agent, app.id)
    for (const authorization of [`Bearer ${token}`, 'Bearer gt_live_x', 'Basic abc']) {
      expect((await tokenRes(agent, app.id, { authorization })).status).toBe(403)
      expect((await call('/api/v1/apps', { headers: { ...h(agent), authorization } })).status).toBe(403)
    }
    expect((await call(`/api/v1/apps/${app.id}/token`, { method: 'POST' })).status).toBe(401)
  })
})

describe('App pages: the page token', () => {
  it('names the page and the role, and has no ticket and no scope', async () => {
    const app = await pageApp({ sidebar_url: `${SIDEBAR_ORIGIN}/card.html` })
    const { token, expires_at, data } = await pageToken(agent, app.id)
    const claims = decodeJwt(token)
    expect(claims).toMatchObject({ iss: 'http://localhost:8787/api/auth', aud: PAGE_ORIGIN, sub: agent.user.id, tikki_app: app.id, tikki_placement: 'page', tikki_role: 'agent' })
    expect(claims).not.toHaveProperty('tikki_ticket')
    expect(claims).not.toHaveProperty('tikki_scope')
    expect(claims.exp! - claims.iat!).toBe(300)
    expect(new Date(expires_at).getTime()).toBe(claims.exp! * 1000)
    expect(data).toEqual({
      version: 1,
      app: { id: app.id, name: app.name, placement: 'page' },
      user: { id: agent.user.id, name: agent.user.name, email: agent.user.email, role: 'agent' },
    })
  })

  it('gets 401 on the ticket, on the comment routes, and at /mcp', async () => {
    const t = await raise(agent)
    const { token } = await pageToken(agent, (await pageApp()).id)
    expect((await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(token) })).status).toBe(401)
    expect((await call(`/api/v1/tickets/${t.ref}/comments`, { headers: bearer(token) })).status).toBe(401)
    expect((await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Logged 2 h.' }, bearer(token))).status).toBe(401)
    expect((await call(`/api/v1/tickets/${t.ref}`, { method: 'PATCH', body: JSON.stringify({ priority: 'high' }), headers: bearer(token) })).status).toBe(401)
    const list = { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), headers: { 'accept': 'application/json, text/event-stream', 'authorization': `Bearer ${token}` } }
    expect((await call('/mcp', list)).status).toBe(401)
  })

  it('still gets 401 on the ticket when Tikki\'s key signs it with a ticket and a scope added', async () => {
    // What a bug or a leaked signer could make: the page placement alone keeps it off the REST API.
    const app = await pageApp({ sidebar_url: `${PAGE_ORIGIN}/card.html` })
    const t = await raise(agent)
    const { token } = await pageToken(agent, app.id)
    const { token: forged } = await useAuth().api.signJWT({ body: { payload: { ...decodeJwt(token), tikki_ticket: t.ref, tikki_scope: 'update' } } })
    expect((await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(forged) })).status).toBe(401)
    // Control: the same token as a sidebar token passes, so the placement is what refuses it.
    const { token: control } = await useAuth().api.signJWT({ body: { payload: { ...decodeJwt(forged), tikki_placement: 'sidebar' } } })
    expect((await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(control) })).status).toBe(200)
  })
})

describe('App pages: the Apps menu', () => {
  it('lists only the apps the User may see, in the admin order', async () => {
    const first = await pageApp()
    const sidebarOnly = await newApp({ sidebar_url: `${SIDEBAR_ORIGIN}/card.html` })
    const off = await pageApp({ enabled: false })
    const forRequesters = await pageApp({ page_for_requesters: true })
    const mine = (list: { id: number }[]) => list.map(a => a.id).filter(id => [first.id, sidebarOnly.id, off.id, forRequesters.id].includes(id))

    const staff = await menu(agent)
    expect(mine(staff)).toEqual([first.id, forRequesters.id])
    expect(staff.find(a => a.id === first.id)).toEqual({ id: first.id, name: first.name, url: `${PAGE_ORIGIN}/page.html?view=week`, icon: { kind: 'builtin', name: 'i-lucide-app-window', color: '#4B5563', light: false, dark: false, version: 0 } })
    expect(mine(await menu(admin))).toEqual([first.id, forRequesters.id])
    expect(mine(await menu(requester))).toEqual([forRequesters.id])
    expect((await call('/api/v1/apps')).status).toBe(401)
  })
})

describe('App pages: admin setting', () => {
  it('stores "Show the page to Requesters", audits it, and refuses it without a page URL', async () => {
    const noPage = await postJson('/api/v1/admin/ticket-apps', { name: 'No page', sidebar_url: `${SIDEBAR_ORIGIN}/card.html`, page_for_requesters: true }, h(admin))
    expect(noPage.status).toBe(422)
    expect(JSON.stringify(await noPage.json())).toContain('page_for_requesters')

    const app = await pageApp({ sidebar_url: `${SIDEBAR_ORIGIN}/card.html` })
    expect(app.page_for_requesters).toBe(false)
    const on = await patchApp(app.id, { page_for_requesters: true })
    expect(((await on.json()) as App).page_for_requesters).toBe(true)
    // Removing the page URL while the page shows to Requesters must say so, not change who sees it silently.
    expect((await patchApp(app.id, { page_url: null })).status).toBe(422)
    expect((await patchApp(app.id, { page_url: null, page_for_requesters: false })).status).toBe(200)
    expect((await patchApp(app.id, { page_for_requesters: 'yes' })).status).toBe(422)

    const entries = await adminAuditOf('ticket_app', app.id)
    expect(entries.map(e => e.action)).toEqual(['ticket_app_created', 'ticket_app_changed', 'ticket_app_changed'])
    expect(entries[0]!.after).toMatchObject({ page_for_requesters: false })
    expect(entries[1]).toMatchObject({ before: { page_for_requesters: false }, after: { page_for_requesters: true } })
    expect(entries[2]).toMatchObject({ before: { page_url: `${PAGE_ORIGIN}/page.html?view=week`, page_for_requesters: true }, after: { page_url: null, page_for_requesters: false } })
  })
})
