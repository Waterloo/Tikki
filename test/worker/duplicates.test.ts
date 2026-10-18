import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, connectMcp, createRestrictedType, getMcpToken, postJson, signInAs, typeId } from './helpers'
// @ts-expect-error The build output has no types.
import builtWorker from '../../.output/server/index.mjs'

const built = builtWorker as ExportedHandler<Cloudflare.Env>

type Session = Awaited<ReturnType<typeof signInAs>>
type Result = { isError?: boolean, structuredContent?: any, content: { type: string, text: string }[] }

const HOUR = 3_600_000
const h = (s: Session) => ({ cookie: s.cookie })
let counter = 0
/** A word no other test uses, so only the tickets of this test match. */
const mark = () => `ZQD${Date.now().toString(36)}${counter++}`

async function connectAs(s: Session) {
  return connectMcp((await getMcpToken(s.cookie)).access_token)
}

async function rest(s: Session, typeIdOf: number, title: string) {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: typeIdOf, title }, h(s))
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as { ref: string, number: number }
}

describe('create_ticket duplicate check', () => {
  it('creates nothing when a similar open ticket exists, and creates it with confirm_new', async () => {
    const agent = await signInAs('agent')
    const gen = await typeId(agent.cookie, 'GEN')
    const m = mark()
    const existing = await rest(agent, gen, `Printer ${m} jammed again`)
    const mine = await connectAs(agent)
    const args = { ticket_type_id: gen, title: `The printer ${m} is jammed` }
    const first = await mine.callTool({ name: 'create_ticket', arguments: args }) as Result
    expect(first.isError).toBe(false)
    expect(first.structuredContent.created).toBe(false)
    expect(first.structuredContent.similar_tickets).toEqual([
      { ref: existing.ref, title: `<untrusted_content>Printer ${m} jammed again</untrusted_content>`, status: 'Open' },
    ])
    const text = first.content[0]!.text
    expect(text).toContain(existing.ref)
    expect(text).toContain('confirm_new')
    expect(text).toContain('add_comment')
    expect(await count(m)).toBe(1)

    const second = await mine.callTool({ name: 'create_ticket', arguments: { ...args, confirm_new: true } }) as Result
    expect(second.isError).toBeFalsy()
    expect(second.structuredContent.ref).toMatch(/^GEN-/)
    expect(await count(m)).toBe(2)
    await mine.close()
  })

  it('never shows tickets the User cannot read, and they do not block the create', async () => {
    const [owner, other, outsider, admin] = await Promise.all([signInAs('requester'), signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const gen = await typeId(admin.cookie, 'GEN')
    const restrictedType = await createRestrictedType()
    const m = mark()

    const privateTicket = await rest(owner, gen, `Private ${m} invoice problem`)
    const restricted = await rest(admin, restrictedType, `Restricted ${m} invoice problem`)
    const deleted = await rest(admin, gen, `Deleted ${m} invoice problem`)
    expect((await call(`/api/v1/tickets/${deleted.ref}`, { method: 'DELETE', headers: h(admin) })).status).toBe(204)

    // Another Requester sees none of them.
    const client = await connectAs(other)
    const r = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: gen, title: `${m} invoice problem` } }) as Result
    expect(r.structuredContent.ref, JSON.stringify(r.structuredContent)).toMatch(/^GEN-/)
    expect(r.structuredContent.similar_tickets).toBeUndefined()
    await client.close()

    // An Agent who is not a Participant sees the private ticket (Agents read all), but not the Restricted or deleted one.
    const agentClient = await connectAs(outsider)
    const a = await agentClient.callTool({ name: 'create_ticket', arguments: { ticket_type_id: gen, title: `${m} invoice problem` } }) as Result
    const refs = (a.structuredContent.similar_tickets ?? []).map((t: { ref: string }) => t.ref)
    expect(refs).toContain(privateTicket.ref)
    expect(refs).not.toContain(restricted.ref)
    expect(refs).not.toContain(deleted.ref)
    expect(JSON.stringify(a)).not.toContain('Restricted')
    expect(JSON.stringify(a)).not.toContain('Deleted')
    await agentClient.close()
  })

  it('is not blocked by a resolved or closed ticket', async () => {
    const agent = await signInAs('agent')
    const gen = await typeId(agent.cookie, 'GEN')
    const m = mark()
    const resolved = await rest(agent, gen, `Login ${m} loop`)
    const closed = await rest(agent, gen, `Login ${m} broken`)
    for (const [t, status] of [[resolved, 'resolved'], [closed, 'closed']] as const) {
      expect((await call(`/api/v1/tickets/${t.ref}`, { method: 'PATCH', body: JSON.stringify({ status }), headers: h(agent) })).status).toBe(200)
    }
    const client = await connectAs(agent)
    const r = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: gen, title: `Login ${m} loop and broken` } }) as Result
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent.ref).toMatch(/^GEN-/)
    await client.close()
  })

  it('counts a blocked call as a write in the rate limits', async () => {
    const agent = await signInAs('agent')
    const gen = await typeId(agent.cookie, 'GEN')
    const m = mark()
    await rest(agent, gen, `Rate ${m} thing`)
    const client = await connectAs(agent)
    const before = await env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM rate_counter WHERE key = ?').bind(`mcp-write:${agent.user.id}`).first<{ n: number }>()
    await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: gen, title: `Rate ${m} thing` } })
    const after = await env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM rate_counter WHERE key = ?').bind(`mcp-write:${agent.user.id}`).first<{ n: number }>()
    expect(after!.n).toBe(before!.n + 1)
    await client.close()
  })
})

async function count(m: string) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM ticket WHERE title LIKE ?').bind(`%${m}%`).first<{ n: number }>()
  return row!.n
}

async function runCron(at: number) {
  const ctx = createExecutionContext()
  await built.scheduled!(createScheduledController({ scheduledTime: at, cron: '* * * * *' }), env, ctx)
  await waitOnExecutionContext(ctx)
}

async function upload(s: Session, path: string) {
  const res = await call(path, { method: 'PUT', body: new Uint8Array([1, 2, 3]), headers: { ...h(s), 'x-filename': 'a.png', 'content-type': 'image/png' } })
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json() as { id: string }).id
}

const row = (id: string) => env.DB.prepare('SELECT id FROM attachment WHERE id = ?').bind(id).first()

describe('upload cleanup in the scheduled run', () => {
  it('deletes unattached uploads older than 24 hours from D1 and R2, and keeps newer and attached ones', async () => {
    const s = await signInAs('requester')
    const gen = await typeId(s.cookie, 'GEN')
    const t = await rest(s, gen, `Cleanup ${mark()} ticket`)
    const old = await upload(s, '/api/v1/attachments')
    const young = await upload(s, '/api/v1/attachments')
    const attached = await upload(s, `/api/v1/tickets/${t.ref}/attachments`)
    // Make `old` 25 hours old, `young` 23, and `attached` 25.
    const now = Date.now()
    await env.DB.prepare('UPDATE attachment SET created_at = ? WHERE id IN (?, ?)').bind(now - 25 * HOUR, old, attached).run()
    await env.DB.prepare('UPDATE attachment SET created_at = ? WHERE id = ?').bind(now - 23 * HOUR, young).run()
    expect(await env.FILES.head(old)).not.toBeNull()

    await runCron(now)
    expect(await row(old)).toBeNull()
    expect(await env.FILES.head(old)).toBeNull()
    expect(await row(young)).not.toBeNull()
    expect(await env.FILES.head(young)).not.toBeNull()
    expect(await row(attached)).not.toBeNull()
    expect(await env.FILES.head(attached)).not.toBeNull()
  })

  it('finishes after an R2 failure: the row stays marked erased, so nobody can claim it, and the next run deletes both', async () => {
    const s = await signInAs('requester')
    const id = await upload(s, '/api/v1/attachments')
    const now = Date.now()
    await env.DB.prepare('UPDATE attachment SET created_at = ? WHERE id = ?').bind(now - 25 * HOUR, id).run()
    const real = env.FILES.delete.bind(env.FILES)
    env.FILES.delete = () => Promise.reject(new Error('R2 down'))
    try {
      await expect(runCron(now)).rejects.toThrow()
    } finally {
      env.FILES.delete = real
    }
    const marked = await env.DB.prepare('SELECT erased_at FROM attachment WHERE id = ?').bind(id).first<{ erased_at: number | null }>()
    expect(marked?.erased_at).not.toBeNull()
    // A new ticket cannot take the marked file.
    const gen = await typeId(s.cookie, 'GEN')
    const claimed = await rest(s, gen, `Claim ${mark()} try`)
    expect((await env.DB.prepare('SELECT ticket_number FROM attachment WHERE id = ?').bind(id).first<{ ticket_number: number | null }>())?.ticket_number).toBeNull()
    expect(claimed.number).toBeGreaterThan(0)

    await runCron(now + 1000)
    expect(await row(id)).toBeNull()
    expect(await env.FILES.head(id)).toBeNull()
  })

  it('deletes used and expired Upload Links older than 24 hours, and keeps newer and valid ones', async () => {
    const s = await signInAs('requester')
    const gen = await typeId(s.cookie, 'GEN')
    const t = await rest(s, gen, `Links ${mark()} ticket`)
    const now = Date.now()
    const insert = (hash: string, expiresAt: number, usedAt: number | null) =>
      env.DB.prepare('INSERT INTO upload_link (token_hash, ticket_number, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(hash, t.number, s.user.id, expiresAt, usedAt, now - 30 * HOUR).run()
    const p = `lnk${mark()}`
    await insert(`${p}-expired-old`, now - 25 * HOUR, null)
    await insert(`${p}-used-old`, now + 5 * HOUR, now - 25 * HOUR)
    await insert(`${p}-expired-new`, now - 23 * HOUR, null)
    await insert(`${p}-used-new`, now + 5 * HOUR, now - 23 * HOUR)
    await insert(`${p}-valid`, now + 5 * HOUR, null)

    await runCron(now)
    const left = await env.DB.prepare('SELECT token_hash FROM upload_link WHERE token_hash LIKE ? ORDER BY token_hash').bind(`${p}%`).all<{ token_hash: string }>()
    expect(left.results.map(r => r.token_hash.slice(p.length + 1))).toEqual(['expired-new', 'used-new', 'valid'])
  })
})
