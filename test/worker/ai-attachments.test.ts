import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, connectMcp, getMcpToken, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>
type Result = { isError?: boolean, structuredContent?: any, content: unknown }

async function connectAs(session: Session) {
  return connectMcp((await getMcpToken(session.cookie)).access_token)
}

async function create(session: Session, title = 'Needs evidence') {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: await typeId(session.cookie, 'GEN'), title }, { cookie: session.cookie })
  expect(res.status).toBe(201)
  return await res.json() as { ref: string, number: number }
}

async function linkFor(session: Session, ref: string) {
  const client = await connectAs(session)
  const r = await client.callTool({ name: 'request_upload_link', arguments: { ticket: ref } }) as Result
  await client.close()
  expect(r.isError).toBeFalsy()
  const url = new URL(r.structuredContent.url as string)
  return { path: url.pathname, token: url.pathname.split('/').pop()!, expiresAt: r.structuredContent.expires_at as string }
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const apiPath = (token: string) => `/api/v1/upload-links/${token}`

function putFile(token: string, cookie: string | null, body: Uint8Array = png) {
  return call(apiPath(token), {
    method: 'PUT', body,
    headers: { ...(cookie ? { cookie } : {}), 'x-filename': 'shot.png', 'content-type': 'image/png' },
  })
}

afterEach(() => vi.useRealTimers())

describe('attach_text', () => {
  it('stores text as a normal Attachment that can be downloaded, and audits it', async () => {
    const agent = await signInAs('agent')
    const t = await create(agent)
    const client = await connectAs(agent)
    const text = 'Stack trace é\nat main()\n'
    const r = await client.callTool({ name: 'attach_text', arguments: { ticket: t.ref, filename: 'trace.log', content: text } }) as Result
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent).toMatchObject({ filename: 'trace.log', content_type: 'text/plain', size: new TextEncoder().encode(text).length })

    const list = await (await call(`/api/v1/tickets/${t.ref}/attachments`, { headers: { cookie: agent.cookie } })).json() as { data: { id: string, url: string, uploader_id: string }[] }
    expect(list.data).toHaveLength(1)
    const file = await call(list.data[0]!.url, { headers: { cookie: agent.cookie } })
    expect(file.headers.get('content-type')).toBe('text/plain')
    expect(file.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(await file.text()).toBe(text)

    const csv = await client.callTool({ name: 'attach_text', arguments: { ticket: t.ref, filename: 'rows.CSV', content: 'a,b\n1,2\n' } }) as Result
    expect(csv.structuredContent.content_type).toBe('text/csv')

    const audit = await env.DB.prepare('SELECT action, channel, principal_id, after FROM audit_log WHERE ticket_number = ? AND action = ?').bind(t.number, 'attachment_added').all()
    expect(audit.results.map(r => [r.channel, r.principal_id, r.after])).toEqual([['ai', agent.user.id, '"trace.log"'], ['ai', agent.user.id, '"rows.CSV"']])
    await client.close()
  })

  it('refuses text above 256 KB in UTF-8 bytes, with a clear error, and accepts exactly 256 KB', async () => {
    const agent = await signInAs('agent')
    const t = await create(agent)
    const client = await connectAs(agent)
    const exact = await client.callTool({ name: 'attach_text', arguments: { ticket: t.ref, filename: 'big.txt', content: 'a'.repeat(256 * 1024) } }) as Result
    expect(exact.isError).toBeFalsy()
    // 131073 two-byte characters: fewer than 256 K characters, but 262146 bytes.
    const over = await client.callTool({ name: 'attach_text', arguments: { ticket: t.ref, filename: 'big.txt', content: 'é'.repeat(131_073) } }) as Result
    expect(over.isError).toBe(true)
    expect(over.structuredContent.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: expect.stringContaining('256 KB') })
    const empty = await client.callTool({ name: 'attach_text', arguments: { ticket: t.ref, filename: 'e.txt', content: '' } }) as Result
    expect(empty.structuredContent.error.code).toBe('EMPTY_FILE')
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachment WHERE ticket_number = ?').bind(t.number).first<{ n: number }>()
    expect(count!.n).toBe(1)
    await client.close()
  })

  it('refuses a Requester on a ticket they cannot read, like REST', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const other = await create(agent)
    const client = await connectAs(requester)
    const r = await client.callTool({ name: 'attach_text', arguments: { ticket: other.ref, filename: 'a.txt', content: 'x' } }) as Result
    const rest = await call(`/api/v1/tickets/${other.ref}/attachments`, { method: 'PUT', body: 'x', headers: { cookie: requester.cookie, 'x-filename': 'a.txt' } })
    expect(r.isError).toBe(true)
    expect(rest.status).toBe(404)
    expect(r.structuredContent).toEqual({ error: { code: 'NOT_FOUND', message: 'No ticket with this reference.' } })
    expect((await rest.json() as any).error).toMatchObject(r.structuredContent.error)
    await client.close()
  })

  it('is listed as a write tool that is not read-only', async () => {
    const client = await connectAs(await signInAs('requester'))
    const { tools } = await client.listTools()
    for (const n of ['attach_text', 'request_upload_link']) {
      expect(tools.find(t => t.name === n)!.annotations, n).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    }
    await client.close()
  })
})

describe('request_upload_link', () => {
  it('refuses a Requester for another person\'s ticket, with the same NOT_FOUND as REST', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const other = await create(agent)
    const client = await connectAs(requester)
    const r = await client.callTool({ name: 'request_upload_link', arguments: { ticket: other.ref } }) as Result
    expect(r.isError).toBe(true)
    expect(r.structuredContent).toEqual({ error: { code: 'NOT_FOUND', message: 'No ticket with this reference.' } })
    const unknown = await client.callTool({ name: 'request_upload_link', arguments: { ticket: 'GEN-99999' } }) as Result
    expect(unknown.structuredContent).toEqual(r.structuredContent)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM upload_link WHERE user_id = ?').bind(requester.user.id).first<{ n: number }>())!.n).toBe(0)
    await client.close()
  })

  it('gives a link for the Requester\'s own ticket, and stores only a hash of the token', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    const { token, path, expiresAt } = await linkFor(requester, t.ref)
    expect(path).toBe(`/upload/${token}`)
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(14 * 60_000)
    const rows = await env.DB.prepare('SELECT token_hash FROM upload_link WHERE user_id = ?').bind(requester.user.id).all<{ token_hash: string }>()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]!.token_hash).not.toContain(token)
    expect(rows.results[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('Upload Link over REST', () => {
  it('works once: the file lands on the ticket, a second upload is refused', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    const { token } = await linkFor(requester, t.ref)

    const info = await call(apiPath(token), { headers: { cookie: requester.cookie } })
    expect(info.status).toBe(200)
    expect(await info.json()).toMatchObject({ ticket_ref: t.ref })
    // Looking at the link does not use it.
    expect((await call(apiPath(token), { headers: { cookie: requester.cookie } })).status).toBe(200)

    const up = await putFile(token, requester.cookie)
    expect(up.status).toBe(201)
    const file = await up.json() as { id: string, url: string, ticket_number: number, uploader_id: string }
    expect(file).toMatchObject({ ticket_number: t.number, uploader_id: requester.user.id })
    const download = await call(file.url, { headers: { cookie: requester.cookie } })
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(png)

    const again = await putFile(token, requester.cookie)
    expect(again.status).toBe(410)
    expect((await again.json() as any).error.code).toBe('LINK_USED')
    expect((await call(apiPath(token), { headers: { cookie: requester.cookie } })).status).toBe(410)
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachment WHERE ticket_number = ?').bind(t.number).first<{ n: number }>()
    expect(n!.n).toBe(1)
  })

  it('lets only one of two parallel uploads win', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    const { token } = await linkFor(requester, t.ref)
    const results = await Promise.all([putFile(token, requester.cookie), putFile(token, requester.cookie), putFile(token, requester.cookie)])
    expect(results.map(r => r.status).sort()).toEqual([201, 410, 410])
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachment WHERE ticket_number = ?').bind(t.number).first<{ n: number }>()
    expect(n!.n).toBe(1)
  })

  it('lets a failed upload try again', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    const { token } = await linkFor(requester, t.ref)
    // Declared 10 bytes, sent fewer: the upload fails and the link is free again.
    const bad = await call(apiPath(token), {
      method: 'PUT', body: new Uint8Array(0), headers: { cookie: requester.cookie, 'x-filename': 'a.png' },
    })
    expect(bad.status).toBe(422)
    expect((await putFile(token, requester.cookie)).status).toBe(201)
  })

  it('fails after 15 minutes (test clock)', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    const { token } = await linkFor(requester, t.ref)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 14 * 60_000 })
    expect((await call(apiPath(token), { headers: { cookie: requester.cookie } })).status).toBe(200)
    vi.setSystemTime(Date.now() + 61_000)
    const late = await putFile(token, requester.cookie)
    expect(late.status).toBe(410)
    expect((await late.json() as any).error.code).toBe('LINK_EXPIRED')
    vi.useRealTimers()
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachment WHERE ticket_number = ?').bind(t.number).first<{ n: number }>()
    expect(n!.n).toBe(0)
  })

  it('fails without a session and for another User\'s session, and stays usable for the owner', async () => {
    const [owner, stranger] = await Promise.all([signInAs('requester'), signInAs('requester')])
    const t = await create(owner)
    const { token } = await linkFor(owner, t.ref)
    expect((await putFile(token, null)).status).toBe(401)
    expect((await call(apiPath(token))).status).toBe(401)
    const other = await putFile(token, stranger.cookie)
    expect(other.status).toBe(403)
    expect((await other.json() as any).error.code).toBe('LINK_WRONG_USER')
    expect((await call(apiPath(token), { headers: { cookie: stranger.cookie } })).status).toBe(403)
    expect((await putFile(token, owner.cookie)).status).toBe(201)
  })

  it('refuses a token that does not exist, and re-checks the policy when the link is used', async () => {
    const owner = await signInAs('requester')
    expect((await putFile('x'.repeat(43), owner.cookie)).status).toBe(404)
    const agent = await signInAs('agent')
    const t = await create(agent)
    const { token } = await linkFor(agent, t.ref)
    // Now a Requester, who cannot read a ticket of someone else.
    await env.DB.prepare('UPDATE user SET role = ? WHERE id = ?').bind('requester', agent.user.id).run()
    await env.DB.prepare('UPDATE ticket SET requester_id = ? WHERE number = ?').bind(owner.user.id, t.number).run()
    const res = await putFile(token, agent.cookie)
    expect(res.status).toBe(404)
    expect((await call(apiPath(token), { headers: { cookie: agent.cookie } })).status).toBe(404)
  })

  it('audits a REST upload to a ticket', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    const res = await call(`/api/v1/tickets/${t.ref}/attachments`, { method: 'PUT', body: 'hello', headers: { cookie: requester.cookie, 'x-filename': 'hi.txt', 'content-type': 'text/plain' } })
    expect(res.status).toBe(201)
    const row = await env.DB.prepare('SELECT channel, principal_id, after FROM audit_log WHERE ticket_number = ? AND action = ?').bind(t.number, 'attachment_added').first()
    expect(row).toEqual({ channel: 'web', principal_id: requester.user.id, after: '"hi.txt"' })
  })
})
