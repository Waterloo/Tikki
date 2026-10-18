import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { useAuth } from '../../server/utils/services'
import { adminAuditOf, BASE, call, postJson, signInAs, typeId } from './helpers'

// Issue 37: one URL for each placement, and a token for one placement (ADR 0005).

type Session = Awaited<ReturnType<typeof signInAs>>
type Urls = Record<'sidebar' | 'tab' | 'page', string | null>
interface App { id: number, name: string, urls: Urls }
interface Ticket { number: number, ref: string }
interface TokenAnswer { token: string, expires_at: string, data: Record<string, any> }

const SIDEBAR_ORIGIN = 'http://localhost:9937'
const TAB_ORIGIN = 'http://127.0.0.1:9938'
const h = (s: Session) => ({ cookie: s.cookie })
const bearer = (jwt: string) => ({ authorization: `Bearer ${jwt}` })

let admin: Session
let agent: Session
let gen: number
let counter = 0

beforeAll(async () => {
  ;[admin, agent] = await Promise.all([signInAs('admin'), signInAs('agent')])
  gen = await typeId(admin.cookie, 'GEN')
})

async function newApp(body: Record<string, unknown>): Promise<App> {
  const res = await postJson('/api/v1/admin/ticket-apps', { name: `Orders ${counter++}`, ...body }, h(admin))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<App>
}

const bothApp = () => newApp({ sidebar_url: `${SIDEBAR_ORIGIN}/card.html?view=small`, tab_url: `${TAB_ORIGIN}/tab.html` })
const patchApp = (id: number, body: unknown) => call(`/api/v1/admin/ticket-apps/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: h(admin) })

async function raise(): Promise<Ticket> {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: gen, title: `Charged twice ${counter++}`, description: 'Order 5521.' }, h(agent))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<Ticket>
}

const tokenRes = (t: Ticket, app: App, body: unknown) =>
  call(`/api/v1/tickets/${t.ref}/apps/${app.id}/token`, { method: 'POST', body: JSON.stringify(body), headers: h(agent) })

async function tokenFor(t: Ticket, app: App, placement: 'sidebar' | 'tab'): Promise<TokenAnswer> {
  const res = await tokenRes(t, app, { placement })
  expect(res.status, await res.clone().text()).toBe(200)
  return res.json() as Promise<TokenAnswer>
}

async function jwks() {
  return createLocalJWKSet(await (await call('/api/auth/jwks')).json() as Parameters<typeof createLocalJWKSet>[0])
}

/** A token signed with Tikki's own keys, with the claims of `jwt` changed: what a bug or a leaked signer could make. */
async function resign(jwt: string, change: Record<string, unknown>): Promise<string> {
  const { token } = await useAuth().api.signJWT({ body: { payload: { ...decodeJwt(jwt), ...change } } })
  return token
}

describe('Ticket App placements: admin', () => {
  it('creates an app with only a tab URL, and refuses to remove the last URL', async () => {
    const app = await newApp({ tab_url: `${TAB_ORIGIN}/tab.html` })
    expect(app.urls).toEqual({ sidebar: null, tab: `${TAB_ORIGIN}/tab.html`, page: null })

    const empty = await patchApp(app.id, { tab_url: null })
    expect(empty.status).toBe(422)
    expect(JSON.stringify(await empty.json())).toContain('at least one URL')

    // A page URL alone is allowed: issue 39 shows it.
    const changed = await patchApp(app.id, { page_url: `${SIDEBAR_ORIGIN}/page.html`, tab_url: '' })
    expect(changed.status, await changed.clone().text()).toBe(200)
    expect(((await changed.json()) as App).urls).toEqual({ sidebar: null, tab: null, page: `${SIDEBAR_ORIGIN}/page.html` })

    const entries = await adminAuditOf('ticket_app', app.id)
    expect(entries.map(e => e.action)).toEqual(['ticket_app_created', 'ticket_app_changed'])
    expect(entries[0]!.after).toMatchObject({ sidebar_url: null, tab_url: `${TAB_ORIGIN}/tab.html`, page_url: null })
    expect(entries[1]).toMatchObject({ before: { tab_url: `${TAB_ORIGIN}/tab.html`, page_url: null }, after: { tab_url: null, page_url: `${SIDEBAR_ORIGIN}/page.html` } })
  })

  it('lists each app once on the ticket, with the URL of each placement', async () => {
    const app = await bothApp()
    const t = await raise()
    const list = (await (await call(`/api/v1/tickets/${t.ref}/apps`, { headers: h(agent) })).json() as { data: App[] }).data
    expect(list.filter(a => a.id === app.id)).toEqual([{ id: app.id, name: app.name, urls: app.urls, icon: expect.objectContaining({ kind: 'builtin' }) }])
  })
})

describe('Ticket App placements: the token', () => {
  it('names its placement, and its audience is the origin of that placement\'s URL', async () => {
    const app = await bothApp()
    const t = await raise()
    const sidebar = await tokenFor(t, app, 'sidebar')
    const tab = await tokenFor(t, app, 'tab')
    expect(decodeJwt(sidebar.token)).toMatchObject({ aud: SIDEBAR_ORIGIN, tikki_placement: 'sidebar', tikki_app: app.id })
    expect(decodeJwt(tab.token)).toMatchObject({ aud: TAB_ORIGIN, tikki_placement: 'tab', tikki_app: app.id })
    expect(sidebar.data.app).toEqual({ id: app.id, name: app.name, placement: 'sidebar' })
    expect(tab.data.app).toEqual({ id: app.id, name: app.name, placement: 'tab' })
    // Both work on the REST API.
    for (const jwt of [sidebar.token, tab.token]) expect((await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(jwt) })).status).toBe(200)
  })

  it('answers 404 for a placement the app has no URL for, and 422 for a missing or unknown placement', async () => {
    const tabOnly = await newApp({ tab_url: `${TAB_ORIGIN}/tab.html` })
    const t = await raise()
    expect((await tokenRes(t, tabOnly, { placement: 'sidebar' })).status).toBe(404)
    expect((await tokenRes(t, tabOnly, { placement: 'tab' })).status).toBe(200)
    // A page token is issue 39.
    expect((await tokenRes(t, tabOnly, { placement: 'page' })).status).toBe(422)
    expect((await tokenRes(t, tabOnly, {})).status).toBe(422)
    expect((await call(`/api/v1/tickets/${t.ref}/apps/${tabOnly.id}/token`, { method: 'POST', headers: h(agent) })).status).toBe(422)
  })

  it('with two origins, a sidebar token with another placement, or presented by the tab origin, gets 401', async () => {
    const app = await bothApp()
    const t = await raise()
    const { token: jwt } = await tokenFor(t, app, 'sidebar')
    const get = (token: string) => call(`/api/v1/tickets/${t.ref}`, { headers: bearer(token) })
    expect((await get(jwt)).status).toBe(200)

    // The tab origin's backend checks the audience and refuses the sidebar token.
    const options = { issuer: `${BASE}/api/auth`, audience: TAB_ORIGIN }
    await expect(jwtVerify(jwt, await jwks(), options)).rejects.toThrow()

    // Tikki compares `aud` with the URL of `tikki_placement`, not with any URL of the app.
    expect((await get(await resign(jwt, { tikki_placement: 'tab' }))).status).toBe(401)
    expect((await get(await resign(jwt, { aud: TAB_ORIGIN }))).status).toBe(401)
    expect((await get(await resign(jwt, { tikki_placement: 'page' }))).status).toBe(401)
    expect((await get(await resign(jwt, { tikki_placement: undefined }))).status).toBe(401)
    // The control: the same signer with the right claims passes, so each 401 above is the placement check.
    expect((await get(await resign(jwt, {}))).status).toBe(200)
  })

  it('stops a placement\'s tokens when its URL is removed or moves to another origin', async () => {
    const app = await bothApp()
    const t = await raise()
    const get = (token: string) => call(`/api/v1/tickets/${t.ref}`, { headers: bearer(token) })
    const sidebar = (await tokenFor(t, app, 'sidebar')).token
    const tab = (await tokenFor(t, app, 'tab')).token

    expect((await patchApp(app.id, { tab_url: `http://localhost:9939/tab.html` })).status).toBe(200)
    expect((await get(tab)).status).toBe(401)
    expect((await get(sidebar)).status).toBe(200)

    expect((await patchApp(app.id, { sidebar_url: null })).status).toBe(200)
    expect((await get(sidebar)).status).toBe(401)
  })
})
