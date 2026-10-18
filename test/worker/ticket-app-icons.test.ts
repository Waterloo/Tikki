import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { adminAuditOf, call, postJson, signInAs } from './helpers'

// Issue 38: Ticket App icons, light and dark (ADR 0005).

type Session = Awaited<ReturnType<typeof signInAs>>
interface Icon { kind: 'builtin' | 'image', name: string, color: string, light: boolean, dark: boolean, version: number }
interface App { id: number, name: string, icon: Icon }

const h = (s: Session) => ({ cookie: s.cookie })
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4])
const WEBP = new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([4, 0, 0, 0], [...'WEBP'].map(c => c.charCodeAt(0)), [1, 2]))
const SVG = new TextEncoder().encode('<?xml version="1.0"?>\n<!-- icon --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')
const HTML = new TextEncoder().encode('<!doctype html><html><body><script>alert(1)</script></body></html>')
const GIF = new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000')

let admin: Session
let agent: Session
let requester: Session
let counter = 0

beforeAll(async () => {
  ;[admin, agent, requester] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('requester')])
})

async function newApp(extra: Record<string, unknown> = {}): Promise<App> {
  const res = await postJson('/api/v1/admin/ticket-apps', { name: `Icons ${counter++}`, sidebar_url: 'http://localhost:9938/card.html', ...extra }, h(admin))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<App>
}

// The content type in the request is a lie on purpose: the server must read the bytes.
const put = (id: number, mode: string, body: Uint8Array, session = admin) =>
  call(`/api/v1/admin/ticket-apps/${id}/icon?mode=${mode}`, { method: 'PUT', body, headers: { ...h(session), 'content-type': 'text/html' } })
const del = (id: number, mode: string) => call(`/api/v1/admin/ticket-apps/${id}/icon?mode=${mode}`, { method: 'DELETE', headers: h(admin) })
const get = (id: number, mode?: string, session?: Session) =>
  call(`/api/v1/ticket-apps/${id}/icon${mode ? `?mode=${mode}` : ''}`, { headers: session ? h(session) : {} })
const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer())

describe('Ticket App icons', () => {
  it('starts with the built-in app-window icon in neutral', async () => {
    const app = await newApp()
    expect(app.icon).toEqual({ kind: 'builtin', name: 'i-lucide-app-window', color: '#4B5563', light: false, dark: false, version: 0 })
    expect((await get(app.id, 'light', admin)).status).toBe(404)
  })

  it('stores a built-in icon and color, and refuses others', async () => {
    const app = await newApp({ icon_name: 'i-lucide-bug', icon_color: '#C2362F' })
    expect(app.icon).toMatchObject({ kind: 'builtin', name: 'i-lucide-bug', color: '#C2362F' })
    const patched = await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: JSON.stringify({ icon_name: 'i-lucide-ticket' }), headers: h(admin) })
    expect(((await patched.json()) as App).icon).toMatchObject({ name: 'i-lucide-ticket', color: '#C2362F' })
    for (const bad of [{ icon_name: 'i-lucide-skull' }, { icon_color: '#123456' }]) {
      const res = await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: JSON.stringify(bad), headers: h(admin) })
      expect(res.status).toBe(422)
    }
    const entries = await adminAuditOf('ticket_app', app.id)
    expect(entries.at(-1)).toMatchObject({ action: 'ticket_app_changed', before: { icon: { name: 'i-lucide-bug' } }, after: { icon: { name: 'i-lucide-ticket' } } })
  })

  it('serves the light and the dark image with the stored type and the sandbox headers', async () => {
    const app = await newApp()
    const light = await put(app.id, 'light', PNG)
    expect(light.status, await light.clone().text()).toBe(200)
    expect(((await light.json()) as App).icon).toMatchObject({ kind: 'image', light: true, dark: false, version: 1 })
    const dark = await put(app.id, 'dark', SVG)
    expect(((await dark.json()) as App).icon).toMatchObject({ light: true, dark: true, version: 2 })

    const l = await get(app.id, 'light', agent)
    expect(l.status).toBe(200)
    expect(l.headers.get('content-type')).toBe('image/png')
    expect(l.headers.get('content-security-policy')).toContain('default-src \'none\'; sandbox')
    expect(l.headers.get('x-content-type-options')).toBe('nosniff')
    expect(l.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(await bytesOf(l)).toEqual(PNG)

    const d = await get(app.id, 'dark', agent)
    expect(d.headers.get('content-type')).toBe('image/svg+xml')
    expect(d.headers.get('content-security-policy')).toContain('default-src \'none\'; sandbox')
    expect(await bytesOf(d)).toEqual(SVG)

    // The audit entry names the kind and the version, never the bytes.
    const entries = await adminAuditOf('ticket_app', app.id)
    expect(entries.map(e => e.action)).toEqual(['ticket_app_created', 'ticket_app_changed', 'ticket_app_changed'])
    expect(entries[1]).toMatchObject({ before: { icon: { kind: 'builtin', version: 0 } }, after: { icon: { kind: 'image', light: true, dark: false, version: 1 } } })
    expect(JSON.stringify(entries)).not.toContain('PNG')
  })

  it('answers the light image when there is no dark image, and reads WebP from the bytes', async () => {
    const app = await newApp()
    expect((await put(app.id, 'light', WEBP)).status).toBe(200)
    const dark = await get(app.id, 'dark', agent)
    expect(dark.status).toBe(200)
    expect(dark.headers.get('content-type')).toBe('image/webp')
    expect(await bytesOf(dark)).toEqual(WEBP)
    // No mode means light.
    expect((await get(app.id, undefined, agent)).headers.get('content-type')).toBe('image/webp')
  })

  it('refuses a file over 256 KB, a GIF and an HTML file that is named .svg with 422', async () => {
    const app = await newApp()
    const big = new Uint8Array(256 * 1024 + 1)
    big.set(PNG)
    const exact = new Uint8Array(256 * 1024)
    exact.set(PNG)
    expect((await put(app.id, 'light', exact)).status).toBe(200)
    for (const body of [big, GIF, HTML, new Uint8Array(0)]) {
      const res = await put(app.id, 'light', body)
      expect(res.status).toBe(422)
      expect(JSON.stringify(await res.json())).toContain('"key":"image"')
    }
    // The failed uploads changed nothing.
    const kept = await get(app.id, 'light', admin)
    expect((await bytesOf(kept)).length).toBe(256 * 1024)
  })

  it('refuses a dark image before a light one, an unknown mode and a missing app', async () => {
    const app = await newApp()
    const early = await put(app.id, 'dark', PNG)
    expect(early.status).toBe(422)
    expect(JSON.stringify(await early.json())).toContain('light image first')
    expect((await put(app.id, 'blue', PNG)).status).toBe(422)
    expect((await call(`/api/v1/admin/ticket-apps/${app.id}/icon`, { method: 'PUT', body: PNG, headers: h(admin) })).status).toBe(422)
    expect((await put(999999, 'light', PNG)).status).toBe(404)
    expect((await get(app.id, 'blue', admin)).status).toBe(422)
  })

  it('lets only the Admin change the icon', async () => {
    const app = await newApp()
    expect((await put(app.id, 'light', PNG, agent)).status).toBe(403)
    expect((await put(app.id, 'light', PNG, requester)).status).toBe(403)
    expect((await call(`/api/v1/admin/ticket-apps/${app.id}/icon?mode=light`, { method: 'PUT', body: PNG })).status).toBe(401)
  })

  it('answers 401 without a session, and 404 to a Requester for an app that is staff only', async () => {
    const app = await newApp()
    await put(app.id, 'light', PNG)
    expect((await get(app.id, 'light')).status).toBe(401)
    expect((await get(app.id, 'light', requester)).status).toBe(404)
    expect((await get(app.id, 'light', agent)).status).toBe(200)
    expect((await get(999999, 'light', agent)).status).toBe(404)
    expect((await get(999999, 'light', requester)).status).toBe(404)
  })

  it('serves a Requester the icon of a page shown to Requesters, and nothing else (issue 39)', async () => {
    const page = 'http://localhost:9938/page.html'
    const shown = await newApp({ page_url: page, page_for_requesters: true })
    const staffPage = await newApp({ page_url: page })
    const off = await newApp({ page_url: page, page_for_requesters: true, enabled: false })
    for (const app of [shown, staffPage, off]) await put(app.id, 'light', PNG)
    expect((await get(shown.id, 'light', requester)).status).toBe(200)
    expect((await get(staffPage.id, 'light', requester)).status).toBe(404)
    expect((await get(off.id, 'light', requester)).status).toBe(404)
    const menu = await (await call('/api/v1/apps', { headers: h(requester) })).json() as { data: { id: number, icon: { kind: string } }[] }
    expect(menu.data.find(a => a.id === shown.id)?.icon.kind).toBe('image')
  })

  it('never serves the image to an API key or a context token without a session', async () => {
    const app = await newApp()
    await put(app.id, 'light', PNG)
    for (const authorization of ['Bearer gt_live_nope', 'Bearer a.b.c']) {
      const res = await call(`/api/v1/ticket-apps/${app.id}/icon?mode=light`, { headers: { authorization } })
      expect(res.status).toBe(401)
    }
  })

  it('removes the dark image alone, and the dark image with the light one', async () => {
    const app = await newApp()
    await put(app.id, 'light', PNG)
    await put(app.id, 'dark', SVG)
    const noDark = (await (await del(app.id, 'dark')).json()) as App
    expect(noDark.icon).toMatchObject({ kind: 'image', light: true, dark: false, version: 3 })
    expect((await get(app.id, 'dark', agent)).headers.get('content-type')).toBe('image/png')
    await vi.waitFor(async () => expect(await env.FILES.head(`ticket-app-icons/${app.id}/dark`)).toBeNull())

    await put(app.id, 'dark', SVG)
    const none = (await (await del(app.id, 'light')).json()) as App
    expect(none.icon).toMatchObject({ kind: 'builtin', light: false, dark: false })
    expect((await get(app.id, 'light', agent)).status).toBe(404)
    await vi.waitFor(async () => expect((await env.FILES.list({ prefix: `ticket-app-icons/${app.id}/` })).objects).toHaveLength(0))
    // Removing what is not there changes nothing, and adds no audit entry.
    const before = (await adminAuditOf('ticket_app', app.id)).length
    expect((await del(app.id, 'light')).status).toBe(200)
    expect(await adminAuditOf('ticket_app', app.id)).toHaveLength(before)
  })

  it('deletes the icon objects with the app', async () => {
    const app = await newApp()
    await put(app.id, 'light', PNG)
    await put(app.id, 'dark', WEBP)
    expect((await env.FILES.list({ prefix: `ticket-app-icons/${app.id}/` })).objects).toHaveLength(2)
    expect((await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'DELETE', headers: h(admin) })).status).toBe(204)
    await vi.waitFor(async () => expect((await env.FILES.list({ prefix: `ticket-app-icons/${app.id}/` })).objects).toHaveLength(0))
    expect((await get(app.id, 'light', admin)).status).toBe(404)
  })

  it('shows the icon in the list the ticket page loads', async () => {
    const app = await newApp({ icon_name: 'i-lucide-database' })
    await put(app.id, 'light', PNG)
    const list = (await (await call('/api/v1/admin/ticket-apps', { headers: h(admin) })).json()) as { data: App[] }
    expect(list.data.find(a => a.id === app.id)!.icon).toMatchObject({ kind: 'image', name: 'i-lucide-database', light: true, version: 1 })
  })
})
