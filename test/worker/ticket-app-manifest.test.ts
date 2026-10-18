import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminAuditOf, call, postJson, signInAs } from './helpers'

// Issue 40: add a Ticket App from its manifest (ADR 0005, docs/ticket-apps-reference.md#manifest).

type Session = Awaited<ReturnType<typeof signInAs>>
interface Change { key: string, before: string | null, after: string | null, warning: string | null }
interface Preview { manifest_url: string, hash: string, manifest: Record<string, any>, icons: { light: string, dark: string | null } | null }
interface Check extends Preview { changes: Change[], granted_access: string }
interface App { id: number, name: string, urls: Record<string, string | null>, access: string, icon: { kind: string, light: boolean, dark: boolean, version: number }, manifest: { url: string, description: string | null, access: string } | null }

const SITE = 'https://time.example.com'
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4])
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'

/** The fake app site: each path answers with its entry. A function makes the answer at fetch time. */
let site: Record<string, () => Response>
let fetched: string[]
let admin: Session
let n = 0

const json = (body: unknown, init: ResponseInit = {}) => () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init })
const manifest = (extra: Record<string, unknown> = {}) => ({
  tikki_app: 1,
  name: `Time tracking ${n}`,
  description: 'Log time on tickets.',
  urls: { sidebar: '/sidebar', tab: `${SITE}/tab`, page: 'timesheet?view=week' },
  icons: { light: '/icon-light.png', dark: '/icon-dark.svg' },
  access: 'comment',
  ...extra,
})

beforeAll(async () => {
  admin = await signInAs('admin')
})

beforeEach(() => {
  n++
  fetched = []
  site = {
    '/tikki-app.json': json(manifest()),
    '/icon-light.png': () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    '/icon-dark.svg': () => new Response(SVG, { headers: { 'content-type': 'image/svg+xml' } }),
  }
  const real = globalThis.fetch
  // The Worker runs in the test isolate, so its outgoing fetch is this one.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    if (url.origin !== SITE) return real(input as RequestInfo, init)
    fetched.push(request.url)
    const answer = site[url.pathname]
    return answer ? answer() : new Response('not found', { status: 404 })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const h = () => ({ cookie: admin.cookie })
const preview = (manifestUrl = `${SITE}/tikki-app.json`) => postJson('/api/v1/admin/ticket-apps/manifest/preview', { manifest_url: manifestUrl }, h())
const create = (body: Record<string, unknown>) => postJson('/api/v1/admin/ticket-apps/manifest', body, h())
const check = (id: number) => postJson(`/api/v1/admin/ticket-apps/${id}/manifest/check`, {}, h())
const apply = (id: number, body: Record<string, unknown>) => postJson(`/api/v1/admin/ticket-apps/${id}/manifest/apply`, body, h())

async function counts() {
  const apps = await env.DB.prepare('SELECT count(*) AS n FROM ticket_app').first<{ n: number }>()
  const audit = await env.DB.prepare('SELECT count(*) AS n FROM audit_log WHERE subject_type = \'ticket_app\'').first<{ n: number }>()
  return { apps: apps!.n, audit: audit!.n }
}

async function added(extra: Record<string, unknown> = {}): Promise<App> {
  const p = await (await preview()).json() as Preview
  const res = await create({ manifest_url: p.manifest_url, hash: p.hash, ...extra })
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<App>
}

describe('Ticket App manifest: preview and add', () => {
  it('previews a valid manifest, and "Add app" saves the URLs, the copied icons and manifest_url', async () => {
    const before = await counts()
    const res = await preview()
    expect(res.status, await res.clone().text()).toBe(200)
    const p = await res.json() as Preview
    expect(p.manifest).toMatchObject({
      version: 1,
      name: `Time tracking ${n}`,
      description: 'Log time on tickets.',
      // Relative URLs resolve against the manifest URL.
      urls: { sidebar: `${SITE}/sidebar`, tab: `${SITE}/tab`, page: `${SITE}/timesheet?view=week` },
      icons: { light: { url: `${SITE}/icon-light.png`, type: 'image/png' }, dark: { url: `${SITE}/icon-dark.svg`, type: 'image/svg+xml' } },
      access: 'comment',
    })
    expect(p.hash).toMatch(/^[0-9a-f]{64}$/)
    // The browser gets the icons from Tikki, never from the app's site.
    expect(p.icons!.light).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`)
    expect(p.icons!.dark).toBe(`data:image/svg+xml;base64,${btoa(SVG)}`)
    expect(await counts()).toEqual(before)

    const types = (await (await call('/api/v1/ticket-types', { headers: h() })).json() as { data: { id: number }[] }).data
    const made = await create({ manifest_url: p.manifest_url, hash: p.hash, access: 'read', ticket_type_ids: [types[0]!.id], page_for_requesters: true })
    expect(made.status, await made.clone().text()).toBe(201)
    const app = await made.json() as App & { ticket_type_ids: number[], page_for_requesters: boolean }
    expect(app).toMatchObject({
      name: `Time tracking ${n}`,
      urls: p.manifest.urls,
      access: 'read',
      ticket_type_ids: [types[0]!.id],
      page_for_requesters: true,
      icon: { kind: 'image', light: true, dark: true },
      manifest: { url: `${SITE}/tikki-app.json`, description: 'Log time on tickets.', access: 'comment' },
    })
    const row = await env.DB.prepare('SELECT manifest_url, manifest_hash FROM ticket_app WHERE id = ?').bind(app.id).first()
    expect(row).toEqual({ manifest_url: `${SITE}/tikki-app.json`, manifest_hash: p.hash })

    // Copied into R2: Tikki serves the bytes it fetched.
    const light = await call(`/api/v1/ticket-apps/${app.id}/icon?mode=light`, { headers: h() })
    expect(light.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await light.arrayBuffer())).toEqual(PNG)
    const dark = await call(`/api/v1/ticket-apps/${app.id}/icon?mode=dark`, { headers: h() })
    expect(await dark.text()).toBe(SVG)

    const audit = await adminAuditOf('ticket_app', app.id)
    expect(audit.map(a => a.action)).toEqual(['ticket_app_created', 'ticket_app_changed'])
    expect(audit[0]!.after).toMatchObject({ name: app.name, access: 'read', manifest_url: `${SITE}/tikki-app.json`, manifest_hash: p.hash })
    expect(audit[1]!.after).toMatchObject({ icon: { kind: 'image', light: true, dark: true } })
  })

  it('defaults to the requested access, ignores unknown keys, and takes a manifest without icons', async () => {
    site['/tikki-app.json'] = json({ ...manifest({ icons: undefined, access: undefined }), future_key: { anything: true } })
    const app = await added()
    expect(app).toMatchObject({ access: 'read', icon: { kind: 'builtin' }, manifest: { access: 'read' } })
    expect(fetched).not.toContain(`${SITE}/icon-light.png`)
  })

  it('refuses more access than the manifest requests (422), on add and on edit', async () => {
    const before = await counts()
    const p = await (await preview()).json() as Preview
    const res = await create({ manifest_url: p.manifest_url, hash: p.hash, access: 'update' })
    expect(res.status).toBe(422)
    expect((await res.json() as { error: { details: { key: string }[] } }).error.details).toEqual([{ key: 'access', reason: expect.stringContaining('comment') }])
    expect(await counts()).toEqual(before)

    const app = await added({ access: 'read' })
    const raise = await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: JSON.stringify({ access: 'update' }), headers: h() })
    expect(raise.status).toBe(422)
    const ok = await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: JSON.stringify({ access: 'comment' }), headers: h() })
    expect(ok.status).toBe(200)
  })

  it('refuses to add when the manifest changed after the preview (409)', async () => {
    const p = await (await preview()).json() as Preview
    site['/tikki-app.json'] = json(manifest({ name: 'Other' }))
    const before = await counts()
    const res = await create({ manifest_url: p.manifest_url, hash: p.hash })
    expect(res.status).toBe(409)
    expect(await counts()).toEqual(before)
  })
})

describe('Ticket App manifest: refusals', () => {
  async function refused(res: Response, key: string, reason: string | RegExp) {
    expect(res.status, await res.clone().text()).toBe(422)
    const { error } = await res.json() as { error: { details: { key: string, reason: string }[] } }
    expect(error.details).toContainEqual({ key, reason: expect.stringMatching(reason) })
  }

  it('refuses a private, loopback or plain-http address without a request', async () => {
    const before = await counts()
    for (const url of ['https://10.0.0.8/tikki-app.json', 'https://169.254.169.254/latest', 'https://localhost/tikki-app.json', 'http://127.0.0.1:8080/x.json', 'https://[::1]/x.json', 'https://printer.local/x.json', 'http://time.example.com/tikki-app.json',
      'https://localhost./x.json', 'https://db.internal./x.json', 'https://[::127.0.0.1]/x.json', 'https://[::ffff:10.0.0.1]/x.json', 'https://[64:ff9b::a00:1]/x.json', 'https://[fec0::1]/x.json']) {
      await refused(await preview(url), 'manifest_url', /public address|https/)
    }
    expect(fetched).toEqual([])
    expect(await counts()).toEqual(before)
  })

  it('refuses a manifest over 64 KB, not JSON, of an unknown version, or without urls, with a clear error', async () => {
    const before = await counts()
    site['/tikki-app.json'] = () => new Response(JSON.stringify({ ...manifest(), padding: 'x'.repeat(64 * 1024) }))
    await refused(await preview(), 'manifest_url', 'The manifest must be 64 KB or smaller.')
    site['/tikki-app.json'] = () => new Response('<!doctype html><title>Home</title>', { headers: { 'content-type': 'text/html' } })
    await refused(await preview(), 'manifest_url', 'The manifest is not valid JSON.')
    site['/tikki-app.json'] = json([1, 2])
    await refused(await preview(), 'manifest_url', 'must be a JSON object')
    site['/tikki-app.json'] = json(manifest({ tikki_app: 2 }))
    await refused(await preview(), 'tikki_app', 'Unknown version 2. This Tikki reads version 1.')
    site['/tikki-app.json'] = json(manifest({ tikki_app: undefined }))
    await refused(await preview(), 'tikki_app', 'Required')
    site['/tikki-app.json'] = json(manifest({ urls: undefined }))
    await refused(await preview(), 'urls', 'Required.')
    site['/tikki-app.json'] = json(manifest({ urls: {} }))
    await refused(await preview(), 'urls', 'Set at least one URL')
    site['/tikki-app.json'] = json(manifest({ name: undefined }))
    await refused(await preview(), 'name', 'Required.')
    site['/tikki-app.json'] = json(manifest({ name: 42, access: 'admin' }))
    const both = await preview()
    expect(((await both.clone().json()) as { error: { details: { key: string }[] } }).error.details.map(d => d.key)).toEqual(['name', 'access'])
    await refused(both, 'name', 'Must be text.')
    expect(await counts()).toEqual(before)
  })

  it('names the key of a bad URL and gives the reason of a bad icon', async () => {
    site['/tikki-app.json'] = json(manifest({ urls: { sidebar: '/ok', tab: 'http://time.example.com/tab' } }))
    await refused(await preview(), 'urls.tab', 'Must use https.')
    site['/tikki-app.json'] = json(manifest({ urls: { page: 'http://localhost:8787/apps' } }))
    await refused(await preview(), 'urls.page', /https|another origin/)
    site['/tikki-app.json'] = json(manifest())
    site['/icon-light.png'] = () => new Response('<html><script>alert(1)</script></html>')
    site['/icon-dark.svg'] = () => new Response(new Uint8Array(256 * 1024 + 1))
    const res = await preview()
    await refused(res.clone(), 'icons.light', 'The image must be a PNG, WebP or SVG file.')
    await refused(res, 'icons.dark', 'The image must be 256 KB or smaller.')
    site['/icon-light.png'] = () => new Response('gone', { status: 404 })
    await refused(await preview(), 'icons.light', 'The server answered 404.')
  })

  it('refuses an unreachable server, an error status, and a redirect to another origin', async () => {
    site['/tikki-app.json'] = () => {
      throw new TypeError('Network connection lost.')
    }
    await refused(await preview(), 'manifest_url', 'Tikki could not reach the server')
    site['/tikki-app.json'] = () => new Response('', { status: 500 })
    await refused(await preview(), 'manifest_url', 'The server answered 500.')
    site['/tikki-app.json'] = () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } })
    await refused(await preview(), 'manifest_url', 'redirects to another origin')
    // On the same origin a redirect is followed, and relative URLs still resolve against the address the Admin gave.
    site['/tikki-app.json'] = () => new Response(null, { status: 301, headers: { location: '/v1/tikki-app.json' } })
    site['/v1/tikki-app.json'] = json(manifest())
    const ok = await preview()
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as Preview).manifest.urls.sidebar).toBe(`${SITE}/sidebar`)
  })
})

describe('Ticket App manifest: updates', () => {
  it('"Check for updates" shows no change for the same manifest', async () => {
    const app = await added()
    const res = await check(app.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ changes: [], granted_access: 'comment' })
  })

  it('returns the changes with warnings, and nothing changes until "Apply"', async () => {
    const app = await added({ access: 'read' })
    const auditBefore = (await adminAuditOf('ticket_app', app.id)).length
    site['/tikki-app.json'] = json(manifest({ name: 'Timesheets', urls: { sidebar: '/sidebar', tab: 'https://new.example.net/tab', page: '/timesheet?view=week' }, access: 'update' }))
    site['/icon-dark.svg'] = () => new Response(SVG.replace('width="1"', 'width="2"'))

    const res = await check(app.id)
    expect(res.status, await res.clone().text()).toBe(200)
    const c = await res.json() as Check
    expect(c.granted_access).toBe('read')
    expect(c.changes).toEqual([
      { key: 'name', before: `Time tracking ${n}`, after: 'Timesheets', warning: null },
      { key: 'urls.tab', before: `${SITE}/tab`, after: 'https://new.example.net/tab', warning: expect.stringContaining('New origin: https://new.example.net') },
      { key: 'icons.dark', before: `${SITE}/icon-dark.svg`, after: `${SITE}/icon-dark.svg`, warning: null },
      { key: 'access', before: 'comment', after: 'update', warning: expect.stringContaining('more access') },
    ])
    // A same-origin URL change gets no warning.
    expect(c.changes.find(x => x.key === 'urls.page')).toBeUndefined()

    const unchanged = await (await call('/api/v1/admin/ticket-apps', { headers: h() })).json() as { data: App[] }
    expect(unchanged.data.find(a => a.id === app.id)).toMatchObject({ name: app.name, urls: app.urls, access: 'read', icon: app.icon })
    expect((await adminAuditOf('ticket_app', app.id)).length).toBe(auditBefore)

    await refusedApply(await apply(app.id, { hash: c.hash }), 422, 'confirm_warnings')
    await refusedApply(await apply(app.id, { hash: c.hash, confirm_warnings: true, access: 'update', extra: 1 }), 422, 'body')
    await refusedApply(await apply(app.id, { hash: '0'.repeat(64), confirm_warnings: true }), 409)

    // Without `access` the granted access stays: an update never raises it by itself.
    const applied = await apply(app.id, { hash: c.hash, confirm_warnings: true })
    expect(applied.status, await applied.clone().text()).toBe(200)
    const after = await applied.json() as App
    expect(after).toMatchObject({ name: 'Timesheets', access: 'read', urls: { tab: 'https://new.example.net/tab' }, icon: { kind: 'image', dark: true, version: app.icon.version + 1 }, manifest: { access: 'update' } })
    const dark = await call(`/api/v1/ticket-apps/${app.id}/icon?mode=dark`, { headers: h() })
    expect(await dark.text()).toContain('width="2"')

    const entry = (await adminAuditOf('ticket_app', app.id)).at(-1)!
    expect(entry.action).toBe('ticket_app_changed')
    expect(entry.before).toMatchObject({ name: app.name, tab_url: `${SITE}/tab`, manifest_update: { 'name': app.name, 'urls.tab': `${SITE}/tab`, 'access': 'comment' } })
    expect(entry.after).toMatchObject({ name: 'Timesheets', tab_url: 'https://new.example.net/tab', manifest_update: { 'name': 'Timesheets', 'urls.tab': 'https://new.example.net/tab', 'access': 'update' } })
    expect(entry.before).not.toHaveProperty('access')

    // The same manifest again: no changes.
    expect((await (await check(app.id)).json() as Check).changes).toEqual([])
  })

  it('raises the access only in the Admin\'s step, at most to the request, and lowers it with the request', async () => {
    const app = await added({ access: 'read' })
    site['/tikki-app.json'] = json(manifest({ access: 'update' }))
    const up = await (await check(app.id)).json() as Check
    const raised = await apply(app.id, { hash: up.hash, confirm_warnings: true, access: 'update' })
    expect(((await raised.json()) as App).access).toBe('update')

    site['/tikki-app.json'] = json(manifest({ access: 'read' }))
    const down = await (await check(app.id)).json() as Check
    expect(down.changes).toEqual([{ key: 'access', before: 'update', after: 'read', warning: null }])
    await refusedApply(await apply(app.id, { hash: down.hash, access: 'comment' }), 422, 'access')
    const lowered = await apply(app.id, { hash: down.hash })
    expect(((await lowered.json()) as App).access).toBe('read')
  })

  it('keeps an Admin\'s own edit of a key that the manifest did not change', async () => {
    const app = await added()
    await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Our name' }), headers: h() })
    site['/tikki-app.json'] = json(manifest({ description: 'New text.' }))
    const c = await (await check(app.id)).json() as Check
    expect(c.changes.map(x => x.key)).toEqual(['description'])
    const res = await apply(app.id, { hash: c.hash })
    expect(await res.json()).toMatchObject({ name: 'Our name', manifest: { description: 'New text.' } })
  })

  it('does not audit a failed fetch, and refuses an app without a manifest', async () => {
    const app = await added()
    const before = await counts()
    site['/tikki-app.json'] = () => new Response('', { status: 503 })
    expect((await check(app.id)).status).toBe(422)
    expect((await apply(app.id, { hash: 'a'.repeat(64) })).status).toBe(422)
    expect(await counts()).toEqual(before)

    const manual = await postJson('/api/v1/admin/ticket-apps', { name: `Manual ${n}`, sidebar_url: `${SITE}/card` }, h())
    const { id } = await manual.json() as App
    expect((await check(id)).status).toBe(422)
  })

  it('is for Admins only: an Agent and an Application get 403 on each route, and Tikki fetches nothing', async () => {
    const app = await added()
    const agent = await signInAs('agent')
    const created = await postJson('/api/v1/applications', { name: `Shop ${n}`, description: 'Shop.', permissions: ['tickets:read'] }, h())
    const { key } = await (await postJson(`/api/v1/applications/${(await created.json() as { id: number }).id}/keys`, { name: 'Prod' }, h())).json() as { key: string }
    const p = await (await preview()).json() as Preview
    fetched = []
    for (const headers of [{ cookie: agent.cookie }, { authorization: `Bearer ${key}` }]) {
      expect((await postJson('/api/v1/admin/ticket-apps/manifest/preview', { manifest_url: `${SITE}/tikki-app.json` }, headers)).status).toBe(403)
      expect((await postJson('/api/v1/admin/ticket-apps/manifest', { manifest_url: p.manifest_url, hash: p.hash }, headers)).status).toBe(403)
      expect((await postJson(`/api/v1/admin/ticket-apps/${app.id}/manifest/check`, {}, headers)).status).toBe(403)
      expect((await postJson(`/api/v1/admin/ticket-apps/${app.id}/manifest/apply`, { hash: p.hash }, headers)).status).toBe(403)
    }
    expect(fetched).toEqual([])
  })
})

async function refusedApply(res: Response, status: number, key?: string) {
  expect(res.status, await res.clone().text()).toBe(status)
  if (key) expect(((await res.json()) as { error: { details: { key: string }[] } }).error.details.map(d => d.key)).toContain(key)
}
