import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { canReadInternalComments, authorizeApplicationComment } from '../../server/utils/policy'
import type { ApplicationPrincipal } from '../../server/utils/tickets'
import { call, createVisibleType, postJson, signInAs, typeId } from './helpers'

interface Ticket {
  number: number
  ref: string
  channel: string
  requester: { kind: string, id: number | string, external_id?: string, name: string, email: string }
  application: { id: number, name: string } | null
  allowed_actions: string[]
}
interface App { id: number, name: string, enabled: boolean, permissions: string[], ticket_types: { id: number }[], keys: { id: number, prefix: string, last_used_at: string | null }[], ticket_count: number }
interface ErrorBody { error: { code: string, message: string, details: unknown } }

const ALL = ['tickets:create', 'tickets:read', 'tickets:update', 'comments:create']

let admin: Awaited<ReturnType<typeof signInAs>>
let gen: number
let bug: number

beforeAll(async () => {
  admin = await signInAs('admin')
  ;[gen, bug] = await Promise.all([typeId(admin.cookie, 'GEN'), typeId(admin.cookie, 'BUG')])
})

let appCounter = 0
async function newApp(permissions = ALL, ticketTypeIds = [gen]) {
  const res = await postJson('/api/v1/applications', { name: `App ${Date.now()} ${appCounter++}`, description: 'Test system.', permissions, ticket_type_ids: ticketTypeIds }, { cookie: admin.cookie })
  expect(res.status).toBe(201)
  const app = await res.json() as App
  const keyRes = await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'Production' }, { cookie: admin.cookie })
  expect(keyRes.status).toBe(201)
  const key = await keyRes.json() as { id: number, key: string, prefix: string }
  return { app, key: key.key, keyId: key.id, prefix: key.prefix }
}

function bearer(key: string, extra: HeadersInit = {}) {
  return { authorization: `Bearer ${key}`, ...extra }
}

function body(ticketTypeId: number, contact: Record<string, string> = { external_id: 'cus_1', name: 'Ana Lima', email: 'ana@shop.example' }, title = 'Card declined') {
  return { ticket_type_id: ticketTypeId, title, description: 'At checkout.', contact }
}

async function create(key: string, payload: unknown, headers: HeadersInit = {}) {
  return postJson('/api/v1/tickets', payload, bearer(key, headers))
}

async function created(key: string, payload: unknown) {
  const res = await create(key, payload)
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Ticket
}

async function ticketCount() {
  return (await env.DB.prepare('SELECT count(*) AS n FROM ticket').first<{ n: number }>())!.n
}

describe('API keys', () => {
  it('creates a ticket with a Contact as Requester for a valid key and an allowed type', async () => {
    const { app, key } = await newApp()
    const ticket = await created(key, body(gen))
    expect(ticket.channel).toBe('api')
    expect(ticket.application).toEqual({ id: app.id, name: app.name })
    expect(ticket.requester).toMatchObject({ kind: 'contact', external_id: 'cus_1', name: 'Ana Lima', email: 'ana@shop.example' })
    // With comments:create it may add a Public Comment, with tickets:update it may cancel; every Agent action stays refused.
    expect(ticket.allowed_actions).toEqual(['comment', 'cancel'])

    // An Agent sees the same Contact as Requester.
    const agent = await signInAs('agent')
    const seen = await (await call(`/api/v1/tickets/${ticket.ref}`, { headers: { cookie: agent.cookie } })).json() as Ticket
    expect(seen.requester).toEqual(ticket.requester)
    const row = await env.DB.prepare('SELECT requester_id, contact_id FROM ticket WHERE number = ?').bind(ticket.number).first()
    expect(row).toEqual({ requester_id: null, contact_id: ticket.requester.id })
  })

  it('refuses a type that is not in the allowed list, the same as a type that does not exist', async () => {
    const { key } = await newApp()
    const before = await ticketCount()
    for (const typeIdToTry of [bug, 999_999]) {
      const res = await create(key, body(typeIdToTry))
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'This Application may not create tickets of this Ticket Type.', details: null } })
    }
    expect(await ticketCount()).toBe(before)
  })

  it('refuses a revoked key at once', async () => {
    const { app, key, keyId } = await newApp()
    await created(key, body(gen))
    const revoke = await call(`/api/v1/applications/${app.id}/keys/${keyId}`, { method: 'DELETE', headers: { cookie: admin.cookie } })
    expect(revoke.status).toBe(204)
    const res = await create(key, body(gen))
    expect(res.status).toBe(401)
    expect(((await res.json()) as ErrorBody).error.code).toBe('UNAUTHENTICATED')
    // The list no longer shows it.
    const detail = await (await call(`/api/v1/applications/${app.id}`, { headers: { cookie: admin.cookie } })).json() as App
    expect(detail.keys).toEqual([])
  })

  it('refuses every key of a disabled Application, and accepts them again when enabled', async () => {
    const { app, key } = await newApp()
    const off = await call(`/api/v1/applications/${app.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }), headers: { cookie: admin.cookie } })
    expect(((await off.json()) as App).enabled).toBe(false)
    const res = await call('/api/v1/tickets', { headers: bearer(key) })
    expect(res.status).toBe(403)
    expect(((await res.json()) as ErrorBody).error.code).toBe('APPLICATION_DISABLED')

    await call(`/api/v1/applications/${app.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }), headers: { cookie: admin.cookie } })
    expect((await call('/api/v1/tickets', { headers: bearer(key) })).status).toBe(200)
  })

  it('refuses unknown and malformed keys, and never falls back to the session cookie', async () => {
    for (const authorization of ['Bearer gt_live_0000', 'Bearer not-a-key', 'Basic abc', 'Bearer']) {
      const res = await call('/api/v1/tickets', { headers: { authorization, cookie: admin.cookie } })
      expect(res.status, authorization).toBe(401)
    }
  })

  it('refuses a create without tickets:create, and a read without tickets:read', async () => {
    const reader = await newApp(['tickets:read'])
    const res = await create(reader.key, body(gen))
    expect(res.status).toBe(403)
    expect(((await res.json()) as ErrorBody).error.message).toBe('This Application does not have the tickets:create permission.')

    const writer = await newApp(['tickets:create'])
    const ticket = await created(writer.key, body(gen))
    for (const path of ['/api/v1/tickets', `/api/v1/tickets/${ticket.ref}`]) {
      const read = await call(path, { headers: bearer(writer.key) })
      expect(read.status, path).toBe(403)
      expect(((await read.json()) as ErrorBody).error.message).toBe('This Application does not have the tickets:read permission.')
    }
  })

  it('marks the key as used', async () => {
    const { app, key } = await newApp()
    await call('/api/v1/tickets', { headers: bearer(key) })
    const detail = await (await call(`/api/v1/applications/${app.id}`, { headers: { cookie: admin.cookie } })).json() as App
    expect(detail.keys[0]!.last_used_at).not.toBeNull()
  })
})

describe('Contacts', () => {
  it('gives the same Contact for the same external ID, and keeps its newest name and email', async () => {
    const { key } = await newApp()
    const first = await created(key, body(gen, { external_id: 'cus_42', name: 'Bo', email: 'bo@shop.example' }))
    const second = await created(key, body(gen, { external_id: 'cus_42', name: 'Bo Chen', email: 'bo.chen@shop.example' }))
    expect(second.requester.id).toBe(first.requester.id)
    expect(second.requester).toMatchObject({ name: 'Bo Chen', email: 'bo.chen@shop.example' })
    const other = await created(key, body(gen, { external_id: 'cus_43', name: 'Bo', email: 'bo@shop.example' }))
    expect(other.requester.id).not.toBe(first.requester.id)
  })

  it('gives two Contacts for the same email from two Applications', async () => {
    const [a, b] = await Promise.all([newApp(), newApp()])
    const contact = { external_id: 'same', name: 'Cy', email: 'cy@shop.example' }
    const fromA = await created(a.key, body(gen, contact))
    const fromB = await created(b.key, body(gen, contact))
    expect(fromA.requester.id).not.toBe(fromB.requester.id)
  })

  it('tells the Application what is wrong with the Contact, with every other problem', async () => {
    const { key } = await newApp()
    const before = await ticketCount()
    const res = await create(key, { ticket_type_id: gen, title: '', contact: { external_id: '', name: 'X', email: 'nope' } })
    expect(res.status).toBe(422)
    const keys = (((await res.json()) as ErrorBody).error.details as { key: string }[]).map(d => d.key)
    expect(keys).toEqual(expect.arrayContaining(['title', 'contact.external_id', 'contact.email']))
    const missing = await create(key, { ticket_type_id: gen, title: 'No contact' })
    expect((((await missing.json()) as ErrorBody).error.details as { key: string }[]).map(d => d.key)).toEqual(['contact'])
    expect(await ticketCount()).toBe(before)
  })
})

describe('the data boundary', () => {
  it('lets Application A read only its own tickets: not B\'s, not a User\'s', async () => {
    const [a, b] = await Promise.all([newApp(), newApp()])
    const mine = await created(a.key, body(gen))
    const theirs = await created(b.key, body(gen))
    const requester = await signInAs('requester')
    const userTicket = await (await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'Internal' }, { cookie: requester.cookie })).json() as Ticket

    expect((await call(`/api/v1/tickets/${mine.ref}`, { headers: bearer(a.key) })).status).toBe(200)
    const missing = await (await call('/api/v1/tickets/999999', { headers: bearer(a.key) })).json()
    for (const ref of [theirs.ref, userTicket.ref]) {
      const res = await call(`/api/v1/tickets/${ref}`, { headers: bearer(a.key) })
      expect(res.status, ref).toBe(404)
      // The same answer as for a ticket that does not exist, so nothing is revealed.
      expect(await res.json()).toEqual(missing)
    }

    const list = await (await call('/api/v1/tickets', { headers: bearer(a.key) })).json() as { data: Ticket[], counts: Record<string, number> }
    expect(list.data.map(t => t.ref)).toEqual([mine.ref])
    expect(list.counts).toEqual({ open: 1 })
  })

  it('hides a Contact\'s ticket of a "visible to all" type from Requesters, and shows it to Agents', async () => {
    const shared = await createVisibleType()
    const { key } = await newApp(ALL, [shared])
    const ticket = await created(key, { ...body(shared), fields: {} })
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    expect((await call(`/api/v1/tickets/${ticket.ref}`, { headers: { cookie: requester.cookie } })).status).toBe(404)
    const list = await (await call('/api/v1/tickets', { headers: { cookie: requester.cookie } })).json() as { data: Ticket[] }
    expect(list.data.map(t => t.ref)).not.toContain(ticket.ref)
    expect((await call(`/api/v1/tickets/${ticket.ref}`, { headers: { cookie: agent.cookie } })).status).toBe(200)
  })

  it('refuses Agent changes and the "me" filters from an Application', async () => {
    const { key } = await newApp()
    const ticket = await created(key, body(gen))
    const res = await call(`/api/v1/tickets/${ticket.ref}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }), headers: bearer(key) })
    expect(res.status).toBe(403)
    expect((await call('/api/v1/tickets?requester=me', { headers: bearer(key) })).status).toBe(422)
  })

  it('shows an Application only its allowed Ticket Types', async () => {
    const { key } = await newApp()
    const list = await (await call('/api/v1/ticket-types', { headers: bearer(key) })).json() as { data: { id: number }[] }
    expect(list.data.map(t => t.id)).toEqual([gen])
    expect((await call(`/api/v1/ticket-types/${gen}`, { headers: bearer(key) })).status).toBe(200)
    expect((await call(`/api/v1/ticket-types/${bug}`, { headers: bearer(key) })).status).toBe(404)
  })

  it('refuses the Admin routes to an API key', async () => {
    const { app, key } = await newApp()
    for (const [method, path] of [['GET', '/api/v1/applications'], ['GET', `/api/v1/applications/${app.id}`], ['GET', '/api/v1/settings/deployment'], ['GET', '/api/v1/setup']]) {
      const res = await call(path!, { method, headers: bearer(key) })
      expect(res.status, path).toBe(403)
    }
  })

  it('never lets an Application see or add Internal Comments (the rule issue 06 uses)', () => {
    const app: ApplicationPrincipal = { kind: 'application', applicationId: 7, permissions: ALL as ApplicationPrincipal['permissions'], ticketTypeIds: [1], channel: 'api' }
    expect(canReadInternalComments(app)).toBe(false)
    expect(canReadInternalComments({ kind: 'user', userId: 'u', role: 'agent', channel: 'web' })).toBe(true)
    const own = { requesterId: null, applicationId: 7, assigneeId: null, visibility: 'requester', participantIds: [] }
    expect(authorizeApplicationComment(app, own, false)).toBeNull()
    expect(authorizeApplicationComment(app, own, true)?.code).toBe('FORBIDDEN')
    expect(authorizeApplicationComment(app, { ...own, applicationId: 8 }, false)?.code).toBe('NOT_FOUND')
    expect(authorizeApplicationComment({ ...app, permissions: ['tickets:read'] }, own, false)?.code).toBe('FORBIDDEN')
  })
})

describe('Idempotency-Key', () => {
  it('returns the first ticket for a repeat and creates nothing new', async () => {
    const { key } = await newApp()
    const headers = { 'idempotency-key': crypto.randomUUID() }
    const first = await create(key, body(gen), headers)
    expect(first.status).toBe(201)
    const ticket = await first.json() as Ticket
    const before = await ticketCount()

    const repeat = await create(key, body(gen), headers)
    expect(repeat.status).toBe(201)
    expect(repeat.headers.get('idempotent-replayed')).toBe('true')
    expect(((await repeat.json()) as Ticket).number).toBe(ticket.number)
    expect(await ticketCount()).toBe(before)
  })

  it('creates one ticket for two concurrent requests with one key', async () => {
    const { key } = await newApp()
    const headers = { 'idempotency-key': crypto.randomUUID() }
    const before = await ticketCount()
    const results = await Promise.all([create(key, body(gen), headers), create(key, body(gen), headers)])
    const numbers = await Promise.all(results.map(async r => ((await r.json()) as Ticket).number))
    expect(results.map(r => r.status)).toEqual([201, 201])
    expect(numbers[0]).toBe(numbers[1])
    expect(await ticketCount()).toBe(before + 1)
  })

  it('answers 409 for the same key with another body, and creates nothing', async () => {
    const { key } = await newApp()
    const headers = { 'idempotency-key': crypto.randomUUID() }
    await create(key, body(gen), headers)
    const before = await ticketCount()
    const res = await create(key, body(gen, undefined, 'Another title'), headers)
    expect(res.status).toBe(409)
    expect(((await res.json()) as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await ticketCount()).toBe(before)
  })

  it('keeps keys apart for each Application, and lets a key expire after 24 hours', async () => {
    const [a, b] = await Promise.all([newApp(), newApp()])
    const headers = { 'idempotency-key': 'order-1' }
    const fromA = await (await create(a.key, body(gen), headers)).json() as Ticket
    const fromB = await (await create(b.key, body(gen), headers)).json() as Ticket
    expect(fromA.number).not.toBe(fromB.number)

    await env.DB.prepare('UPDATE idempotency_key SET created_at = ? WHERE application_id = ?').bind(Date.now() - 25 * 60 * 60 * 1000, a.app.id).run()
    const again = await create(a.key, body(gen, undefined, 'A new order with the old key'), headers)
    expect(again.status).toBe(201)
    expect(again.headers.get('idempotent-replayed')).toBeNull()
    expect(((await again.json()) as Ticket).number).not.toBe(fromA.number)
  })

  it('does not record a key when the create fails', async () => {
    const { key } = await newApp()
    const headers = { 'idempotency-key': crypto.randomUUID() }
    expect((await create(key, { ...body(gen), title: '' }, headers)).status).toBe(422)
    expect((await create(key, body(gen), headers)).status).toBe(201)
  })
})

describe('key storage', () => {
  it('keeps only a SHA-256 hash of the key, and the shown prefix', async () => {
    const { app, key, prefix } = await newApp()
    expect(key).toMatch(/^gt_live_[0-9a-f]{64}$/)
    expect(prefix).toBe(key.slice(0, 12))
    const rows = await env.DB.prepare('SELECT * FROM api_key WHERE application_id = ?').bind(app.id).all()
    expect(rows.results).toHaveLength(1)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
    const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
    expect(rows.results[0]!.key_hash).toBe(hex)
    const secret = key.slice(prefix.length)
    expect(JSON.stringify(rows.results)).not.toContain(secret)
    // The Admin view never shows the key again.
    const detail = await (await call(`/api/v1/applications/${app.id}`, { headers: { cookie: admin.cookie } })).text()
    expect(detail).not.toContain(secret)
  })
})

describe('Admin Applications API', () => {
  it('is only for Admins', async () => {
    const agent = await signInAs('agent')
    expect((await call('/api/v1/applications', { headers: { cookie: agent.cookie } })).status).toBe(403)
    expect((await postJson('/api/v1/applications', { name: 'X' }, { cookie: agent.cookie })).status).toBe(403)
  })

  it('checks names, permissions, and Ticket Type IDs', async () => {
    const { app } = await newApp()
    const cases: [unknown, string][] = [
      [{ name: app.name }, 'name'],
      [{ name: 'Ok', permissions: ['tickets:delete'] }, 'permissions'],
      [{ name: 'Ok', ticket_type_ids: [999_999] }, 'ticket_type_ids'],
      [{ name: '' }, 'name'],
    ]
    for (const [payload, key] of cases) {
      const res = await postJson('/api/v1/applications', payload, { cookie: admin.cookie })
      expect(res.status, JSON.stringify(payload)).toBe(422)
      expect((((await res.json()) as ErrorBody).error.details as { key: string }[])[0]!.key).toBe(key)
    }
  })

  it('lists Applications with their ticket count, and updates permissions and types', async () => {
    const { app, key } = await newApp()
    await created(key, body(gen))
    const list = await (await call('/api/v1/applications', { headers: { cookie: admin.cookie } })).json() as { data: App[] }
    expect(list.data.find(a => a.id === app.id)).toMatchObject({ ticket_count: 1, enabled: true })

    const res = await call(`/api/v1/applications/${app.id}`, { method: 'PATCH', body: JSON.stringify({ permissions: ['tickets:read'], ticket_type_ids: [gen, bug] }), headers: { cookie: admin.cookie } })
    const updated = await res.json() as App
    expect(updated.permissions).toEqual(['tickets:read'])
    expect(updated.ticket_types.map(t => t.id).sort()).toEqual([gen, bug].sort())
    // The next request uses the new permissions.
    expect((await create(key, body(gen))).status).toBe(403)
  })
})

describe('OpenAPI', () => {
  it('serves a valid OpenAPI 3.1 document that lists the create endpoint', async () => {
    const res = await call('/api/v1/openapi.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const doc = await res.json() as Record<string, any>

    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toMatchObject({ title: expect.any(String), version: expect.any(String) })
    const create = doc.paths['/api/v1/tickets'].post
    expect(create.operationId).toBe('createTicket')
    expect(create.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/TicketCreate' })
    expect(create.responses['201']).toBeDefined()

    // The request schema comes from the zod definitions that validate the body.
    const ticketCreate = doc.components.schemas.TicketCreate
    expect(ticketCreate.type).toBe('object')
    expect(ticketCreate.required).toEqual(expect.arrayContaining(['title', 'ticket_type_id', 'contact']))
    expect(ticketCreate.properties.contact.required).toEqual(['external_id', 'name', 'email'])
    expect(ticketCreate.properties.priority.enum).toEqual(['low', 'normal', 'high', 'urgent'])

    // Structure checks of the OpenAPI 3.1 rules we use: every operation has responses, every $ref resolves,
    // every path parameter is declared, and no JSON Schema keyword is a draft-04 leftover.
    const refs: string[] = []
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === '$ref') refs.push(v as string)
          expect(k).not.toBe('$schema')
          walk(v)
        }
      }
    }
    walk(doc)
    for (const r of refs) {
      expect(r).toMatch(/^#\/components\/schemas\//)
      expect(doc.components.schemas[r.split('/').pop()!], r).toBeDefined()
    }
    for (const [path, item] of Object.entries(doc.paths as Record<string, Record<string, any>>)) {
      expect(path).toMatch(/^\//)
      for (const op of Object.values(item)) {
        expect(Object.keys(op.responses).length).toBeGreaterThan(0)
        for (const name of path.match(/\{(\w+)\}/g) ?? []) {
          expect(op.parameters.some((p: { in: string, name: string, required: boolean }) => p.in === 'path' && `{${p.name}}` === name && p.required)).toBe(true)
        }
      }
    }
    expect(doc.components.securitySchemes.apiKey).toMatchObject({ type: 'http', scheme: 'bearer' })
  })
})

// The features merged before issue 12 (06, 08, 09, 10, 16, 17, 18), with an Application and a Contact Requester.
describe('Applications and the merged features', () => {
  interface Comment { id: string, visibility: string, body: string, author: { kind: string, id: number | string, name: string } }
  interface Event { type: 'event' | 'comment', action?: string, principal?: { kind: string, id: number | string, name: string }, comment?: Comment }

  const comment = (ref: string, payload: unknown, headers: HeadersInit) => postJson(`/api/v1/tickets/${ref}/comments`, payload, headers)
  const patch = (ref: string, payload: unknown, headers: HeadersInit) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(payload), headers })
  const upload = (path: string, headers: HeadersInit) => call(path, { method: 'PUT', body: new TextEncoder().encode('log line'), headers: { 'x-filename': 'log.txt', 'content-type': 'text/plain', ...headers } })

  it('lets an Application add Public Comments only, and never shows it Internal Comments', async () => {
    const [{ app, key }, agent] = await Promise.all([newApp(), signInAs('agent')])
    const t = await created(key, body(gen))
    const internal = await comment(t.ref, { body: 'Staff only', visibility: 'internal' }, { cookie: agent.cookie })
    expect(internal.status).toBe(201)

    const mine = await comment(t.ref, { body: 'Customer says hi' }, bearer(key))
    expect(mine.status, await mine.clone().text()).toBe(201)
    expect(await mine.json()).toMatchObject({ visibility: 'public', author: { kind: 'contact', contact: { external_id: 'cus_1', name: 'Ana Lima' }, application: { id: app.id, name: app.name } } })
    expect((await comment(t.ref, { body: 'Sneaky', visibility: 'internal' }, bearer(key))).status).toBe(403)

    const comments = await (await call(`/api/v1/tickets/${t.ref}/comments`, { headers: bearer(key) })).json() as { data: Comment[] }
    expect(comments.data.map(c => c.body)).toEqual(['Customer says hi'])
    const internalId = (await internal.json() as Comment).id
    expect((await call(`/api/v1/tickets/${t.ref}/comments/${internalId}`, { headers: bearer(key) })).status).toBe(404)
    const detail = await (await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(key) })).json() as { comment_count: number }
    expect(detail.comment_count).toBe(1)

    const row = await env.DB.prepare('SELECT author_id, application_id FROM comment WHERE ticket_number = ? AND visibility = \'public\'').bind(t.number).first()
    expect(row).toEqual({ author_id: null, application_id: app.id })
  })

  it('refuses comments without comments:create, and on another source\'s ticket', async () => {
    const [{ key: readOnly }, other] = await Promise.all([newApp(['tickets:create', 'tickets:read']), newApp()])
    const t = await created(readOnly, body(gen))
    expect((await comment(t.ref, { body: 'Hi' }, bearer(readOnly))).status).toBe(403)
    expect((await comment(t.ref, { body: 'Hi' }, bearer(other.key))).status).toBe(404)
  })

  it('shows the Application as the actor in Activity and writes its ID in the audit log', async () => {
    const { app, key } = await newApp()
    const t = await created(key, body(gen))
    await comment(t.ref, { body: 'More detail' }, bearer(key))
    const rows = await env.DB.prepare('SELECT action, principal_id, application_id FROM audit_log WHERE ticket_number = ? ORDER BY id').bind(t.number).all()
    expect(rows.results).toEqual([
      { action: 'ticket_created', principal_id: null, application_id: app.id },
      { action: 'comment_added', principal_id: null, application_id: app.id },
    ])
    const agent = await signInAs('agent')
    const { data: items } = await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: { cookie: agent.cookie } })).json() as { data: Event[] }
    const actor = { kind: 'contact', contact: { id: t.requester.id, external_id: 'cus_1', name: 'Ana Lima', email: 'ana@shop.example' }, application: { id: app.id, name: app.name } }
    expect(items.find(i => i.action === 'ticket_created')?.principal).toEqual(actor)
    expect(items.find(i => i.type === 'comment')?.comment?.author).toEqual(actor)
  })

  it('tells staff of a new Contact ticket, names the Application, and writes no notice for the Contact', async () => {
    const { app, key } = await newApp()
    const agent = await signInAs('agent')
    const t = await created(key, body(gen))
    const notices = await env.DB.prepare('SELECT user_id, actor_id FROM notification WHERE ticket_number = ?').bind(t.number).all<{ user_id: string, actor_id: string | null }>()
    expect(notices.results.map(n => n.user_id)).toContain(agent.user.id)
    expect(notices.results.every(n => n.actor_id === null)).toBe(true)
    const inbox = await (await call('/api/v1/notifications', { headers: { cookie: agent.cookie } })).json() as { data: { head: string }[] }
    expect(inbox.data.map(n => n.head)).toContain(`${app.name} created ${t.ref}`)

    // A status change and a Public Comment by an Agent: the Contact has no Inbox, so nothing goes to a NULL User.
    const before = (await env.DB.prepare('SELECT count(*) AS n FROM notification').first<{ n: number }>())!.n
    expect((await patch(t.ref, { status: 'in_progress', assignee_id: agent.user.id }, { cookie: agent.cookie })).status).toBe(200)
    expect((await comment(t.ref, { body: 'On it', visibility: 'public' }, { cookie: agent.cookie })).status).toBe(201)
    expect((await env.DB.prepare('SELECT count(*) AS n FROM notification').first<{ n: number }>())!.n).toBe(before)

    // The Application's reply goes to the assignee.
    expect((await comment(t.ref, { body: 'Customer replied' }, bearer(key))).status).toBe(201)
    const reply = await env.DB.prepare('SELECT user_id, actor_id FROM notification WHERE ticket_number = ? AND kind = \'public_comment\'').bind(t.number).all()
    expect(reply.results).toEqual([{ user_id: agent.user.id, actor_id: null }])
  })

  it('lets an Application upload to and read its own ticket only', async () => {
    const [{ app, key }, other, requester] = await Promise.all([newApp(), newApp(), signInAs('requester')])
    const mine = await created(key, body(gen))
    const theirs = await created(other.key, body(gen))
    const userTicket = await (await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'Internal' }, { cookie: requester.cookie })).json() as Ticket

    const up = await upload(`/api/v1/tickets/${mine.ref}/attachments`, bearer(key))
    expect(up.status, await up.clone().text()).toBe(201)
    const file = await up.json() as { id: string, url: string, uploader_id: string | null, application_id: number | null }
    expect(file).toMatchObject({ uploader_id: null, application_id: app.id })
    expect((await call(file.url, { headers: bearer(key) })).status).toBe(200)
    expect((await call(`/api/v1/tickets/${mine.ref}/attachments`, { headers: bearer(key) })).status).toBe(200)

    for (const ref of [theirs.ref, userTicket.ref]) {
      expect((await upload(`/api/v1/tickets/${ref}/attachments`, bearer(key))).status, ref).toBe(404)
      expect((await call(`/api/v1/tickets/${ref}/attachments`, { headers: bearer(key) })).status, ref).toBe(404)
    }
    expect((await call(file.url, { headers: bearer(other.key) })).status).toBe(404)
    // No upload before the ticket exists, and no Upload Link: both belong to a User.
    expect((await upload('/api/v1/attachments', bearer(key))).status).toBe(403)
    expect((await upload('/api/v1/upload-links/some-token', bearer(key))).status).toBe(403)
    // An Agent reads the Application's file; a Requester cannot see the Contact's ticket at all.
    const agent = await signInAs('agent')
    expect((await call(file.url, { headers: { cookie: agent.cookie } })).status).toBe(200)
    expect((await call(file.url, { headers: { cookie: requester.cookie } })).status).toBe(404)
  })

  it('keeps Contact tickets out of a Requester\'s reach: no edit, cancel, reopen, search or similar match', async () => {
    const shared = await createVisibleType()
    const { key } = await newApp(ALL, [shared])
    const word = `zq${crypto.randomUUID().slice(0, 8)}`
    const t = await created(key, { ...body(shared), title: `${word} refund missing`, fields: {} })
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const asRequester = { cookie: requester.cookie }

    expect((await patch(t.ref, { description: 'Mine now' }, asRequester)).status).toBe(404)
    expect((await postJson(`/api/v1/tickets/${t.ref}/cancel`, {}, asRequester)).status).toBe(404)
    expect((await postJson(`/api/v1/tickets/${t.ref}/reopen`, {}, asRequester)).status).toBe(404)
    const search = await (await call(`/api/v1/tickets?q=${word}`, { headers: asRequester })).json() as { data: Ticket[] }
    expect(search.data).toEqual([])
    const similar = await (await call(`/api/v1/tickets/similar?title=${word}%20refund`, { headers: asRequester })).json() as { data: Ticket[] }
    expect(similar.data).toEqual([])

    // Staff and the source Application find it; an Agent may edit it, but it has no User to cancel or reopen it.
    const staff = await (await call(`/api/v1/tickets?q=${word}`, { headers: { cookie: agent.cookie } })).json() as { data: Ticket[] }
    expect(staff.data.map(x => x.ref)).toEqual([t.ref])
    const own = await (await call(`/api/v1/tickets?q=${word}`, { headers: bearer(key) })).json() as { data: Ticket[] }
    expect(own.data.map(x => x.ref)).toEqual([t.ref])
    const detail = await (await call(`/api/v1/tickets/${t.ref}`, { headers: { cookie: agent.cookie } })).json() as Ticket
    expect(detail.allowed_actions).toEqual(expect.arrayContaining(['edit_description', 'change_type']))
    expect(detail.allowed_actions).not.toContain('cancel')
    expect(detail.allowed_actions).not.toContain('reopen')
  })

  it('refuses edit, type change, and revert to an Application', async () => {
    const { key } = await newApp()
    const t = await created(key, body(gen))
    expect((await patch(t.ref, { description: 'Edited by the API' }, bearer(key))).status).toBe(403)
    expect((await call(`/api/v1/tickets/${t.ref}/type`, { method: 'PUT', body: JSON.stringify({ ticket_type_id: bug }), headers: bearer(key) })).status).toBe(403)
    const agent = await signInAs('agent')
    await patch(t.ref, { priority: 'high' }, { cookie: agent.cookie })
    const entry = await env.DB.prepare('SELECT id FROM audit_log WHERE ticket_number = ? AND action = \'priority_changed\'').bind(t.number).first<{ id: number }>()
    expect((await postJson(`/api/v1/tickets/${t.ref}/activity/${entry!.id}/revert`, {}, bearer(key))).status).toBe(403)
  })
})

describe('Application actions for Contacts (issue 13)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const act = (ref: string, what: 'cancel' | 'reopen', key: string) => postJson(`/api/v1/tickets/${ref}/${what}`, {}, bearer(key))
  const get = async (ref: string, key: string) => await (await call(`/api/v1/tickets/${ref}`, { headers: bearer(key) })).json() as Ticket & { status: { key: string }, assignee: unknown, assigned: boolean }
  const setStatus = async (ref: string, status: string) => {
    const agent = await signInAs('agent')
    expect((await patch(ref, { status }, { cookie: agent.cookie })).status).toBe(200)
  }
  const patch = (ref: string, payload: unknown, headers: HeadersInit) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(payload), headers })

  it('shows an Application comment as Public, written by the Contact through the Application', async () => {
    const { app, key } = await newApp()
    const t = await created(key, body(gen))
    const res = await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Any update?' }, bearer(key))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ visibility: 'public', author: { kind: 'contact', contact: { id: t.requester.id, name: 'Ana Lima' }, application: { id: app.id } } })
    // Stored as the Application; the Contact comes from the ticket.
    const row = await env.DB.prepare('SELECT author_id, application_id FROM comment WHERE ticket_number = ?').bind(t.number).first()
    expect(row).toEqual({ author_id: null, application_id: app.id })
  })

  it('cancels its own ticket, with the comment and audit entry of a Requester cancel', async () => {
    const { app, key } = await newApp()
    const t = await created(key, body(gen))
    expect((await get(t.ref, key)).allowed_actions).toEqual(['comment', 'cancel'])
    const res = await act(t.ref, 'cancel', key)
    expect(res.status, await res.clone().text()).toBe(200)
    expect((await res.json() as { status: { key: string } }).status.key).toBe('closed')
    const rows = await env.DB.prepare('SELECT action, application_id, principal_id FROM audit_log WHERE ticket_number = ? ORDER BY id').bind(t.number).all()
    expect(rows.results.map(r => r.action)).toEqual(['ticket_created', 'ticket_cancelled', 'comment_added'])
    expect(rows.results.slice(1).every(r => r.application_id === app.id && r.principal_id === null)).toBe(true)
  })

  it('refuses a cancel of a ticket that is done', async () => {
    const { key } = await newApp()
    const t = await created(key, body(gen))
    await setStatus(t.ref, 'resolved')
    const res = await act(t.ref, 'cancel', key)
    expect(res.status).toBe(403)
    expect((await res.json() as ErrorBody).error.message).toBe('A ticket that is done cannot be cancelled.')
  })

  it('reopens a resolved ticket in 14 days, and creates a linked ticket after that', async () => {
    const { key } = await newApp()
    const t = await created(key, body(gen))
    expect((await act(t.ref, 'reopen', key)).status).toBe(403)
    await setStatus(t.ref, 'resolved')
    expect((await get(t.ref, key)).allowed_actions).toEqual(['comment', 'reopen'])
    await env.DB.prepare('UPDATE audit_log SET created_at = created_at - ? WHERE ticket_number = ?').bind(13 * DAY, t.number).run()
    const same = await act(t.ref, 'reopen', key)
    expect(same.status).toBe(200)
    expect(await same.json()).toMatchObject({ number: t.number, status: { key: 'open' } })

    await setStatus(t.ref, 'resolved')
    await env.DB.prepare('UPDATE audit_log SET created_at = created_at - ? WHERE ticket_number = ?').bind(15 * DAY, t.number).run()
    const fresh = await act(t.ref, 'reopen', key)
    expect(fresh.status).toBe(201)
    const body2 = await fresh.json() as Ticket & { reopened_from: unknown }
    expect(body2.number).not.toBe(t.number)
    expect(body2.reopened_from).toEqual({ number: t.number, ref: t.ref })
    // Same Contact, same Application.
    expect(body2.requester.id).toBe(t.requester.id)
    expect(body2.application).toEqual(t.application)
  })

  it('refuses cancel and reopen without tickets:update, and on another Application\'s ticket', async () => {
    const [{ key: noUpdate }, other] = await Promise.all([newApp(['tickets:create', 'tickets:read', 'comments:create']), newApp()])
    const t = await created(noUpdate, body(gen))
    for (const what of ['cancel', 'reopen'] as const) {
      const res = await act(t.ref, what, noUpdate)
      expect(res.status).toBe(403)
      expect((await res.json() as ErrorBody).error.message).toContain('tickets:update')
      const foreign = await act(t.ref, what, other.key)
      expect(foreign.status).toBe(404)
      expect((await foreign.json() as ErrorBody).error.code).toBe('NOT_FOUND')
    }
    const mine = await created(other.key, body(gen))
    const ownRes = await act(mine.ref, 'cancel', noUpdate)
    expect(ownRes.status).toBe(404)
    // The ticket did not change.
    expect((await get(t.ref, noUpdate)).status.key).toBe('open')
    expect((await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'x' }, bearer(other.key))).status).toBe(404)
  })

  it('hides the assignee and Agent names from an Application', async () => {
    const { key } = await newApp()
    const t = await created(key, body(gen))
    expect(await get(t.ref, key)).toMatchObject({ assignee: null, assigned: false })
    const agent = await signInAs('agent')
    expect((await patch(t.ref, { assignee_id: agent.user.id }, { cookie: agent.cookie })).status).toBe(200)
    await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'We are on it.', visibility: 'public' }, { cookie: agent.cookie })

    const seen = await get(t.ref, key)
    expect(seen).toMatchObject({ assignee: null, assigned: true })
    const list = await (await call('/api/v1/tickets', { headers: bearer(key) })).json() as { data: { ref: string, assignee: unknown, assigned: boolean }[] }
    expect(list.data.find(x => x.ref === t.ref)).toMatchObject({ assignee: null, assigned: true })

    const comments = await call(`/api/v1/tickets/${t.ref}/comments`, { headers: bearer(key) })
    const activity = await call(`/api/v1/tickets/${t.ref}/activity`, { headers: bearer(key) })
    for (const res of [comments, activity]) {
      const text = await res.text()
      expect(text).not.toContain(agent.user.email)
      expect(text).toContain('"kind":"support"')
    }
    // Staff still see the name.
    const staff = await (await call(`/api/v1/tickets/${t.ref}`, { headers: { cookie: agent.cookie } })).json() as { assignee: { id: string }, assigned: boolean }
    expect(staff).toMatchObject({ assignee: { id: agent.user.id }, assigned: true })
  })
})
