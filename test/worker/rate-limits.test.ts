import { beforeAll, describe, expect, it, vi } from 'vitest'
import { call, connectMcp, getMcpToken, postJson, requestCode, signInAs, typeId, uniqueEmail } from './helpers'

// A test may wait up to 8 s for a fresh minute.
vi.setConfig({ testTimeout: 30_000 })

interface ErrorBody { error: { code: string, message: string } }

/** Counters are fixed one-minute windows. A test must not straddle a boundary, so it waits for a fresh minute. */
async function freshWindow() {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < 8_000) await new Promise(r => setTimeout(r, left + 50))
}

let admin: Awaited<ReturnType<typeof signInAs>>
let gen: number

beforeAll(async () => {
  admin = await signInAs('admin')
  gen = await typeId(admin.cookie, 'GEN')
})

let n = 0
async function newKey(limits: { rate_limit?: number, create_limit?: number } = {}) {
  const app = await (await postJson('/api/v1/applications', { name: `Limited ${Date.now()} ${n++}`, permissions: ['tickets:read', 'tickets:create'], ticket_type_ids: [gen] }, { cookie: admin.cookie })).json() as { id: number }
  if (Object.keys(limits).length) {
    const res = await call(`/api/v1/applications/${app.id}`, { method: 'PATCH', body: JSON.stringify(limits), headers: { cookie: admin.cookie } })
    expect(res.status, await res.clone().text()).toBe(200)
  }
  const key = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'k' }, { cookie: admin.cookie })).json() as { key: string }
  return { appId: app.id, headers: { authorization: `Bearer ${key.key}` } }
}

const list = (headers: HeadersInit) => call('/api/v1/tickets', { headers })

describe('REST rate limits', () => {
  it('refuses the 61st request in a minute with 429 and Retry-After', async () => {
    await freshWindow()
    const { headers } = await newKey()
    for (let i = 0; i < 60; i++) expect((await list(headers)).status).toBe(200)
    const res = await list(headers)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(60)
    expect(((await res.json()) as ErrorBody).error.code).toBe('RATE_LIMITED')
  })

  it('applies a changed limit to that Application only', async () => {
    await freshWindow()
    const low = await newKey({ rate_limit: 3, create_limit: 1 })
    const other = await newKey()
    for (let i = 0; i < 3; i++) expect((await list(low.headers)).status).toBe(200)
    expect((await list(low.headers)).status).toBe(429)
    for (let i = 0; i < 5; i++) expect((await list(other.headers)).status).toBe(200)
  })

  it('limits creates apart from other requests', async () => {
    await freshWindow()
    const { headers } = await newKey({ create_limit: 2 })
    const make = (i: number) => postJson('/api/v1/tickets', { ticket_type_id: gen, title: `T${i}`, description: 'x', contact: { external_id: 'c1', name: 'Ana', email: 'ana@shop.example' } }, headers)
    expect((await make(1)).status).toBe(201)
    expect((await make(2)).status).toBe(201)
    const third = await make(3)
    expect(third.status).toBe(429)
    expect(third.headers.get('retry-after')).toBeTruthy()
    expect((await list(headers)).status).toBe(200)
  })

  it('refuses a create limit above the request limit', async () => {
    const { appId } = await newKey()
    const res = await call(`/api/v1/applications/${appId}`, { method: 'PATCH', body: JSON.stringify({ create_limit: 500 }), headers: { cookie: admin.cookie } })
    expect(res.status).toBe(422)
  })

  it('limits a web User to 120 requests a minute', async () => {
    await freshWindow()
    const user = await signInAs('requester')
    for (let i = 0; i < 120; i++) expect((await list({ cookie: user.cookie })).status).toBe(200)
    const res = await list({ cookie: user.cookie })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
  })
})

describe('MCP rate limits', () => {
  it('refuses the 11th write in a minute with a tool error, and reads still work', async () => {
    await freshWindow()
    const session = await signInAs('agent')
    const client = await connectMcp((await getMcpToken(session.cookie)).access_token)
    // The ticket does not exist: the call still counts as a write.
    const write = () => client.callTool({ name: 'add_comment', arguments: { ticket: 'GEN-999999', body: 'x', visibility: 'public' } }) as Promise<{ isError?: boolean, content: { text: string }[] }>
    for (let i = 0; i < 10; i++) expect((await write()).content[0]!.text).not.toContain('RATE_LIMITED')
    const refused = await write()
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toMatch(/^RATE_LIMITED: .*Try again in \d+ second/)
    const read = await client.callTool({ name: 'list_my_tickets', arguments: {} }) as { isError?: boolean }
    expect(read.isError).toBeFalsy()
    await client.close()
  })

  it('refuses the 31st tool call in a minute', async () => {
    await freshWindow()
    const session = await signInAs('agent')
    const client = await connectMcp((await getMcpToken(session.cookie)).access_token)
    const read = () => client.callTool({ name: 'list_my_tickets', arguments: {} }) as Promise<{ isError?: boolean, content: { text: string }[] }>
    for (let i = 0; i < 30; i++) expect((await read()).isError).toBeFalsy()
    expect((await read()).content[0]!.text).toContain('RATE_LIMITED')
    await client.close()
  })
})

describe('sign-in rate limit', () => {
  it('refuses the 11th attempt from one IP in a minute, and not another IP', async () => {
    await freshWindow()
    const ip = { 'cf-connecting-ip': '203.0.113.7' }
    const attempt = () => postJson('/api/auth/sign-in/email-otp', { email: uniqueEmail(), otp: '000000' }, ip)
    for (let i = 0; i < 10; i++) expect((await attempt()).status).not.toBe(429)
    const res = await attempt()
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
    expect(await res.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    expect((await requestCode(uniqueEmail())).status).toBe(200)
  })
})
