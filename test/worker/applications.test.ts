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
    expect(ticket.allowed_actions).toEqual([])

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
    const own = { requesterId: null, applicationId: 7, visibleToAll: false }
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
