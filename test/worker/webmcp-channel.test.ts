import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { call, postJson, signInAs, typeId } from './helpers'

// Issue 36: the WebMCP tools in the page send `X-Tikki-Channel: ai` with the session.

// The rate-limit test may wait up to 8 s for a fresh minute.
vi.setConfig({ testTimeout: 30_000 })

type Session = Awaited<ReturnType<typeof signInAs>>
interface Ticket { number: number, ref: string }

const AI = { 'x-tikki-channel': 'ai' }

let admin: Session
let agent: Session
let requester: Session
let gen: number
let counter = 0

beforeAll(async () => {
  ;[admin, agent, requester] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('requester')])
  gen = await typeId(admin.cookie, 'GEN')
})

async function raise(): Promise<Ticket> {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: gen, title: `Printer offline ${counter++}`, description: 'Floor 3.' }, { cookie: requester.cookie })
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<Ticket>
}

async function freshWindow() {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < 8_000) await new Promise(r => setTimeout(r, left + 50))
}

describe('X-Tikki-Channel: ai', () => {
  it.each([
    ['with the header', AI, 'ai'],
    ['without the header', {}, 'web'],
  ] as const)('a session write %s records channel %s in the comment, the audit entry and the Event', async (_label, headers, channel) => {
    const t = await raise()
    const comment = await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Restarted it.', visibility: 'public' }, { cookie: agent.cookie, ...headers })
    expect(comment.status, await comment.clone().text()).toBe(201)
    const { id } = await comment.json() as { id: string }
    const patched = await call(`/api/v1/tickets/${t.ref}`, { method: 'PATCH', body: JSON.stringify({ status: 'in_progress' }), headers: { cookie: agent.cookie, ...headers } })
    expect(patched.status, await patched.clone().text()).toBe(200)

    expect(await env.DB.prepare('SELECT channel FROM comment WHERE id = ?').bind(id).first()).toEqual({ channel })
    const entries = await env.DB.prepare('SELECT action, channel, principal_id FROM audit_log WHERE ticket_number = ? AND action IN (\'comment_added\', \'status_changed\') ORDER BY id').bind(t.number).all()
    expect(entries.results).toEqual([
      { action: 'comment_added', channel, principal_id: agent.user.id },
      { action: 'status_changed', channel, principal_id: agent.user.id },
    ])
    const events = await env.DB.prepare('SELECT type, payload FROM outbox_event WHERE ticket_number = ? AND type IN (\'comment.created\', \'ticket.updated\') ORDER BY created_at').bind(t.number).all<{ type: string, payload: string }>()
    expect(events.results.map(e => e.type)).toEqual(['comment.created', 'ticket.updated'])
    for (const e of events.results) expect(JSON.parse(e.payload).actor).toMatchObject({ kind: 'user', id: agent.user.id, channel })
  })

  it('changes the label only: a Requester with the header still cannot change the Status', async () => {
    const t = await raise()
    const res = await call(`/api/v1/tickets/${t.ref}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }), headers: { cookie: requester.cookie, ...AI } })
    expect(res.status).toBe(403)
  })

  it('answers 400 INVALID_CHANNEL for another value', async () => {
    const res = await call('/api/v1/tickets', { headers: { cookie: agent.cookie, 'x-tikki-channel': 'robot' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_CHANNEL')
  })

  it('answers 400 on an API-key request', async () => {
    const app = await (await postJson('/api/v1/applications', { name: `WebMCP ${Date.now()}`, permissions: ['tickets:read'], ticket_type_ids: [gen] }, { cookie: admin.cookie })).json() as { id: number }
    const { key } = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'k' }, { cookie: admin.cookie })).json() as { key: string }
    expect((await call('/api/v1/tickets', { headers: { authorization: `Bearer ${key}` } })).status).toBe(200)
    const res = await call('/api/v1/tickets', { headers: { authorization: `Bearer ${key}`, ...AI } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_CHANNEL')
  })

  it('answers 400 on a context-token request, before the token is checked', async () => {
    // Any JWT form goes to the context-token check; the header must stop it first.
    const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'
    expect((await call('/api/v1/tickets/GEN-1', { headers: { authorization: `Bearer ${jwt}` } })).status).toBe(401)
    const res = await call('/api/v1/tickets/GEN-1', { headers: { authorization: `Bearer ${jwt}`, ...AI } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_CHANNEL')
  })

  it('puts writes under USER_MCP_WRITE_LIMIT: the 11th write in a minute answers RATE_LIMITED with Retry-After', async () => {
    const t = await raise()
    await freshWindow()
    const session = await signInAs('agent')
    const write = () => postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Checking.' }, { cookie: session.cookie, ...AI })
    for (let i = 0; i < 10; i++) expect((await write()).status).toBe(201)
    const refused = await write()
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(((await refused.json()) as { error: { code: string, message: string } }).error).toMatchObject({ code: 'RATE_LIMITED', message: expect.stringMatching(/^Too many tool calls\. Try again in \d+ second/) })
    // Reads use the larger tool-call limit; a request without the header uses the web limit.
    expect((await call(`/api/v1/tickets/${t.ref}`, { headers: { cookie: session.cookie, ...AI } })).status).toBe(200)
    expect((await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'By hand.' }, { cookie: session.cookie })).status).toBe(201)
  })
})
