import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, postJson, signIn, typeId, uniqueEmail } from './helpers'

interface OrgView { name: string, subtitle: string, logo_url: string | null }

async function admin() {
  const session = await signIn(uniqueEmail())
  await env.DB.prepare('UPDATE user SET role = \'admin\' WHERE id = ?').bind(session.user.id).run()
  return session
}

/** A PNG: the signature, then zeros. The server checks the signature, not the picture. */
function png(size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  return bytes
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

function putLogo(cookie: string, body: BodyInit, type = 'image/png') {
  return call('/api/v1/organization/logo', { method: 'PUT', body, headers: { cookie, 'content-type': type } })
}

function patchOrg(cookie: string, body: unknown) {
  return call('/api/v1/organization', { method: 'PATCH', body: JSON.stringify(body), headers: { cookie } })
}

describe('organization settings REST API', () => {
  it('shows the default name to everyone, even without a session', async () => {
    const res = await call('/api/v1/organization')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Ticketing', subtitle: 'Support desk', logo_url: null })
  })

  it('lets only Admins change settings', async () => {
    const { cookie } = await signIn(uniqueEmail())
    expect((await patchOrg('', { name: 'Hack' })).status).toBe(401)
    expect((await patchOrg(cookie, { name: 'Hack' })).status).toBe(403)
    expect((await putLogo(cookie, png())).status).toBe(403)
    expect((await call('/api/v1/organization/logo', { method: 'DELETE', headers: { cookie } })).status).toBe(403)
    expect((await call('/api/v1/settings/deployment', { headers: { cookie } })).status).toBe(403)
    expect((await call('/api/v1/setup', { headers: { cookie } })).status).toBe(403)
    expect(await (await call('/api/v1/organization')).json()).toMatchObject({ name: 'Ticketing' })
  })

  it('lets an Admin change the name and subtitle, and everyone reads them', async () => {
    const { cookie } = await admin()
    const res = await patchOrg(cookie, { name: '  Acme Support ', subtitle: 'Internal IT' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Acme Support', subtitle: 'Internal IT', logo_url: null })

    const { cookie: other } = await signIn(uniqueEmail())
    expect(await (await call('/api/v1/organization', { headers: { cookie: other } })).json()).toMatchObject({ name: 'Acme Support', subtitle: 'Internal IT' })

    // A partial update keeps the other value.
    expect(await (await patchOrg(cookie, { subtitle: '' })).json()).toMatchObject({ name: 'Acme Support', subtitle: '' })
  })

  it('refuses an empty name, a long name, and unknown keys', async () => {
    const { cookie } = await admin()
    for (const body of [{ name: '   ' }, { name: 'x'.repeat(61) }, { subtitle: 'x'.repeat(81) }, { name: 5 }, { role: 'admin' }]) {
      const res = await patchOrg(cookie, body)
      expect(res.status).toBe(422)
      expect((await res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('refuses an SVG as a logo, even when it claims to be a PNG', async () => {
    const { cookie } = await admin()
    const asSvg = await putLogo(cookie, SVG, 'image/svg+xml')
    expect(asSvg.status).toBe(415)
    expect((await asSvg.json() as { error: { code: string } }).error.code).toBe('LOGO_NOT_PNG')
    expect((await putLogo(cookie, SVG, 'image/png')).status).toBe(415)
    expect((await call('/api/v1/organization/logo')).status).toBe(404)
  })

  it('refuses a logo above 1 MB and accepts one of exactly 1 MB', async () => {
    const { cookie } = await admin()
    const tooLarge = await putLogo(cookie, png(1024 * 1024 + 1))
    expect(tooLarge.status).toBe(413)
    expect((await tooLarge.json() as { error: { code: string } }).error.code).toBe('LOGO_TOO_LARGE')
    expect((await putLogo(cookie, png(1024 * 1024))).status).toBe(200)
    await call('/api/v1/organization/logo', { method: 'DELETE', headers: { cookie } })
  })

  it('stores a PNG logo, serves it to everyone, and removes it', async () => {
    const { cookie } = await admin()
    const put = await putLogo(cookie, png())
    expect(put.status).toBe(200)
    const org = await put.json() as OrgView
    expect(org.logo_url).toMatch(/^\/api\/v1\/organization\/logo\?v=\d+$/)

    const served = await call(org.logo_url!)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png())

    const removed = await call('/api/v1/organization/logo', { method: 'DELETE', headers: { cookie } })
    expect(await removed.json()).toMatchObject({ logo_url: null })
    expect((await call('/api/v1/organization/logo')).status).toBe(404)
  })

  it('shows the deployment values to Admins and never the secret', async () => {
    const { cookie } = await admin()
    const res = await call('/api/v1/settings/deployment', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      address: 'http://localhost:8787',
      connector_url: 'http://localhost:8787/mcp',
      environment: 'test',
      sign_in: { methods: ['Email code'], allowed_domains: ['example.com', 'example.org'] },
      mail: { transport: 'capture', from: null, last_error: null },
    })
    expect(JSON.stringify(body)).not.toContain('test-secret')
  })
})

describe('first run', () => {
  it('reports that no ticket exists until the first ticket, then drops the example types', async () => {
    await env.DB.prepare('DELETE FROM ticket').run()
    const { cookie } = await admin()

    const before = await (await call('/api/v1/setup', { headers: { cookie } })).json() as {
      first_ticket_exists: boolean, connector_url: string, allowed_domains: string[], ticket_types: { prefix: string }[]
    }
    expect(before.first_ticket_exists).toBe(false)
    expect(before.connector_url).toBe('http://localhost:8787/mcp')
    expect(before.allowed_domains).toEqual(['example.com', 'example.org'])
    expect(before.ticket_types.map(t => t.prefix)).toEqual(['BUG', 'DATA', 'GEN'])

    const created = await postJson('/api/v1/tickets', { ticket_type_id: await typeId(cookie, 'GEN'), title: 'First' }, { cookie })
    expect(created.status).toBe(201)

    const after = await (await call('/api/v1/setup', { headers: { cookie } })).json() as { first_ticket_exists: boolean }
    expect(after.first_ticket_exists).toBe(true)
  })
})
