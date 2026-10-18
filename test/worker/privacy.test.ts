import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { call, connectMcp, getMcpToken, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>
interface Ticket { number: number, ref: string, title: string, description: string, fields: Record<string, unknown>, status: { key: string }, requester: { kind: string, id: number | string, name: string, email: string, external_id?: string }, allowed_actions: string[] }
interface ErrorBody { error: { code: string } }
type McpResult = { isError?: boolean, structuredContent?: any }

const ALL = ['tickets:create', 'tickets:read', 'tickets:update', 'comments:create']

let admin: Session
let bug: number
let gen: number

beforeAll(async () => {
  admin = await signInAs('admin')
  ;[bug, gen] = await Promise.all([typeId(admin.cookie, 'BUG'), typeId(admin.cookie, 'GEN')])
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A word that no other row holds, so a scan finds only what the test wrote. */
const marker = (label: string) => `${label}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`

const as = (s: Session) => ({ cookie: s.cookie })
const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const get = (path: string, headers: HeadersInit) => call(path, { headers })

let appCounter = 0
async function newApp(types = [bug]) {
  const res = await postJson('/api/v1/applications', { name: `Shop ${Date.now()} ${appCounter++}`, permissions: ALL, ticket_type_ids: types }, as(admin))
  expect(res.status).toBe(201)
  const app = await res.json() as { id: number }
  const key = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'Production' }, as(admin))).json() as { key: string }
  return { id: app.id, key: key.key }
}

async function created(res: Response): Promise<Ticket> {
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Ticket
}

function upload(ref: string, headers: Record<string, string>, filename: string, content: string) {
  return call(`/api/v1/tickets/${ref}/attachments`, { method: 'PUT', body: new TextEncoder().encode(content), headers: { ...headers, 'x-filename': filename, 'content-type': 'text/plain' } })
}

async function addEndpoint() {
  const res = await postJson('/api/v1/webhooks', { name: 'Audit tool', url: `https://hooks.test-receiver.com/${crypto.randomUUID()}` }, as(admin))
  expect(res.status).toBe(201)
}

async function eventCount(number: number) {
  return (await env.DB.prepare('SELECT count(*) AS n FROM outbox_event WHERE ticket_number = ?').bind(number).first<{ n: number }>())!.n
}

async function mcpAs(s: Session) {
  return connectMcp((await getMcpToken(s.cookie)).access_token)
}

describe('soft delete', () => {
  it('hides a deleted ticket from every channel, and shows it again after restore', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const app = await newApp()
    const word = marker('Hidden')
    const own = await created(await postJson('/api/v1/tickets', { ticket_type_id: gen, title: `Printer ${word} jammed again` }, as(requester)))
    const forContact = await created(await postJson('/api/v1/tickets', {
      ticket_type_id: bug, title: `Checkout ${word} broken`, fields: { page_or_feature: 'Cart' }, contact: { external_id: marker('cus'), name: 'Ana Lima', email: 'ana@shop.example' },
    }, bearer(app.key)))
    expect((await postJson(`/api/v1/tickets/${own.ref}/comments`, { body: 'We are on it.', visibility: 'public' }, as(agent))).status).toBe(201)
    const file = await (await upload(own.ref, as(requester), 'log.txt', 'printer log')).json() as { id: string }
    await addEndpoint()

    // Only an Admin may delete. The ticket shows the action only to Admins.
    expect((await (await get(`/api/v1/tickets/${own.ref}`, as(admin))).json() as Ticket).allowed_actions).toContain('delete')
    expect((await (await get(`/api/v1/tickets/${own.ref}`, as(agent))).json() as Ticket).allowed_actions).not.toContain('delete')
    expect((await call(`/api/v1/tickets/${own.ref}`, { method: 'DELETE', headers: as(agent) })).status).toBe(403)
    expect((await call(`/api/v1/tickets/${own.ref}`, { method: 'DELETE', headers: as(requester) })).status).toBe(403)
    expect((await call(`/api/v1/tickets/${forContact.ref}`, { method: 'DELETE', headers: bearer(app.key) })).status).toBe(403)

    const events = [await eventCount(own.number), await eventCount(forContact.number)]
    for (const t of [own, forContact]) expect((await call(`/api/v1/tickets/${t.ref}`, { method: 'DELETE', headers: as(admin) })).status).toBe(204)
    // A second delete finds no ticket.
    expect((await call(`/api/v1/tickets/${own.ref}`, { method: 'DELETE', headers: as(admin) })).status).toBe(404)

    async function hidden(visible: boolean) {
      const status = visible ? 200 : 404
      // REST, for every User role. Admins too: the deleted list is their one place.
      for (const s of [requester, agent, admin]) {
        expect((await get(`/api/v1/tickets/${own.ref}`, as(s))).status, 'detail').toBe(status)
        for (const path of ['comments', 'activity', 'attachments']) expect((await get(`/api/v1/tickets/${own.ref}/${path}`, as(s))).status, path).toBe(status)
        expect((await get(`/api/v1/attachments/${file.id}`, as(s))).status, 'download').toBe(status)
        const list = await (await get(`/api/v1/tickets?q=${word}`, as(s))).json() as { data: Ticket[], counts: Record<string, number> }
        expect(list.data.some(t => t.number === own.number), 'search').toBe(visible)
        expect(Object.values(list.counts).reduce((a, b) => a + b, 0), 'counts').toBe(list.data.length)
        const similar = await (await get(`/api/v1/tickets/similar?title=${encodeURIComponent(`Printer ${word}`)}`, as(s))).json() as { data: Ticket[] }
        expect(similar.data.some(t => t.number === own.number), 'similar').toBe(visible)
      }
      for (const s of [agent, admin]) {
        const list = await (await get(`/api/v1/tickets?q=${word}`, as(s))).json() as { data: Ticket[] }
        expect(list.data.some(t => t.number === forContact.number), 'staff search').toBe(visible)
      }
      // Changes: refused like a ticket that does not exist.
      if (!visible) {
        const patch = await call(`/api/v1/tickets/${own.ref}`, { method: 'PATCH', body: JSON.stringify({ priority: 'high' }), headers: as(agent) })
        expect(patch.status).toBe(404)
        expect((await patch.json() as ErrorBody).error.code).toBe('NOT_FOUND')
        expect((await postJson(`/api/v1/tickets/${own.ref}/comments`, { body: 'Hello?' }, as(requester))).status).toBe(404)
        expect((await upload(own.ref, as(admin), 'x.txt', 'x')).status).toBe(404)
        expect((await postJson(`/api/v1/tickets/${own.ref}/cancel`, {}, as(requester))).status).toBe(404)
        expect((await postJson(`/api/v1/tickets/${forContact.ref}/comments`, { body: 'Any news?' }, bearer(app.key))).status).toBe(404)
      }
      // The Application.
      expect((await get(`/api/v1/tickets/${forContact.ref}`, bearer(app.key))).status, 'application detail').toBe(status)
      const appList = await (await get('/api/v1/tickets', bearer(app.key))).json() as { data: Ticket[] }
      expect(appList.data.some(t => t.number === forContact.number), 'application list').toBe(visible)
      // The Inbox.
      const inbox = await (await get('/api/v1/notifications', as(requester))).json() as { data: { ticket: { ref: string } | null }[], unread_count: number }
      expect(inbox.data.some(n => n.ticket?.ref === own.ref), 'inbox').toBe(visible)
      expect(inbox.unread_count, 'unread count').toBe(inbox.data.length)
      // MCP, as the Admin.
      const client = await mcpAs(admin)
      const got = await client.callTool({ name: 'get_ticket', arguments: { ticket: own.ref } }) as McpResult
      expect(!got.isError, 'mcp get_ticket').toBe(visible)
      const found = await client.callTool({ name: 'search_tickets', arguments: { query: word } }) as McpResult
      expect(JSON.stringify(found.structuredContent).includes(own.ref), 'mcp search').toBe(visible)
      await client.close()
    }

    await hidden(false)
    // No Event was written for the delete, nor for the refused changes.
    expect([await eventCount(own.number), await eventCount(forContact.number)]).toEqual(events)

    // The one place for Admins.
    const deleted = await (await get('/api/v1/tickets/deleted', as(admin))).json() as { data: { ref: string, deleted_by: { id: string } | null }[] }
    expect(deleted.data.find(d => d.ref === own.ref)?.deleted_by?.id).toBe(admin.user.id)
    expect(deleted.data.some(d => d.ref === forContact.ref)).toBe(true)
    expect((await get('/api/v1/tickets/deleted', as(agent))).status).toBe(404)
    expect((await get('/api/v1/tickets/deleted', bearer(app.key))).status).toBe(404)

    // Restore: Admins only; for anyone else the ticket does not exist.
    expect((await postJson(`/api/v1/tickets/${own.ref}/restore`, {}, as(agent))).status).toBe(404)
    expect((await postJson(`/api/v1/tickets/${forContact.ref}/restore`, {}, bearer(app.key))).status).toBe(404)
    for (const t of [own, forContact]) expect((await postJson(`/api/v1/tickets/${t.ref}/restore`, {}, as(admin))).status).toBe(200)
    expect((await postJson(`/api/v1/tickets/${own.ref}/restore`, {}, as(admin))).status).toBe(404)
    await hidden(true)

    // Both are in the audit log, and the next change writes Events again.
    const activity = await (await get(`/api/v1/tickets/${own.ref}/activity`, as(admin))).json() as { data: { action?: string, principal?: { id: string } }[] }
    const actions = activity.data.filter(a => a.action === 'ticket_deleted' || a.action === 'ticket_restored')
    expect(actions.map(a => [a.action, a.principal?.id])).toEqual([['ticket_deleted', admin.user.id], ['ticket_restored', admin.user.id]])
    expect((await call(`/api/v1/tickets/${own.ref}`, { method: 'PATCH', body: JSON.stringify({ priority: 'high' }), headers: as(agent) })).status).toBe(200)
    expect(await eventCount(own.number)).toBe(events[0]! + 1)
  })
})

/** Every row of every table, every column as text: so a table added later is covered without a change here. */
async function databaseHits(strings: string[]): Promise<string[]> {
  const { results: tables } = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`).all<{ name: string }>()
  const hits: string[] = []
  for (const { name } of tables) {
    const { results: columns } = await env.DB.prepare(`SELECT name FROM pragma_table_info(?)`).bind(name).all<{ name: string }>()
    for (const s of strings) {
      const where = columns.map(c => `instr(lower(CAST("${c.name}" AS TEXT)), lower(?1)) > 0`).join(' OR ')
      const row = await env.DB.prepare(`SELECT count(*) AS n FROM "${name}" WHERE ${where}`).bind(s).first<{ n: number }>()
      if (row!.n > 0) hits.push(`${name}: ${s}`)
    }
  }
  return hits
}

/** Every object in the bucket, read as text. */
async function bucketHits(strings: string[]): Promise<string[]> {
  const hits: string[] = []
  let cursor: string | undefined
  do {
    const page = await env.FILES.list({ cursor, include: ['httpMetadata', 'customMetadata'] })
    for (const o of page.objects) {
      const text = `${o.key} ${JSON.stringify(o.customMetadata ?? {})} ${await (await env.FILES.get(o.key))!.text()}`
      for (const s of strings) if (text.toLowerCase().includes(s.toLowerCase())) hits.push(`${o.key}: ${s}`)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return hits
}

/** A Contact with two tickets that hold its data in every place the system writes to. */
async function contactWithData(app: { key: string }, agent: Session) {
  const person = { external_id: marker('cus'), name: `${marker('Zora')} Quaxley`, email: `${marker('zq')}@contact.example` }
  const secret = {
    title1: marker('RefundOrder'), title2: marker('LostParcel'), description: marker('ShippedTo'), field: marker('CartPage'),
    publicComment: marker('PublicReply'), internalComment: marker('InternalNote'), filename: `${marker('receipt')}.txt`, fileText: marker('FileBody'),
  }
  const one = await created(await postJson('/api/v1/tickets', {
    ticket_type_id: bug, title: `${secret.title1} please`, description: `${secret.description} ${person.email}`, fields: { page_or_feature: secret.field }, contact: person,
  }, { ...bearer(app.key), 'idempotency-key': marker('idem') }))
  const two = await created(await postJson('/api/v1/tickets', { ticket_type_id: bug, title: secret.title2, fields: { page_or_feature: 'Cart' }, contact: person }, bearer(app.key)))
  expect((await postJson(`/api/v1/tickets/${one.ref}/comments`, { body: `${secret.publicComment} from ${person.name}` }, bearer(app.key))).status).toBe(201)
  expect((await postJson(`/api/v1/tickets/${one.ref}/comments`, { body: `${secret.internalComment} ${person.email}`, visibility: 'internal' }, as(agent))).status).toBe(201)
  const patched = await call(`/api/v1/tickets/${one.ref}`, { method: 'PATCH', body: JSON.stringify({ status: 'in_progress', fields: { page_or_feature: `${secret.field} v2` }, description: `${secret.description} edited` }), headers: as(agent) })
  expect(patched.status).toBe(200)
  const file = await (await upload(one.ref, bearer(app.key), secret.filename, `${secret.fileText} for ${person.name}`)).json() as { id: string }
  await env.DB.prepare('INSERT INTO upload_link (token_hash, ticket_number, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(marker('hash'), two.number, agent.user.id, Date.now() + 60_000, Date.now()).run()
  return { person, secret, one, two, file, strings: [...Object.values(person), ...Object.values(secret)] }
}

describe('Erasure', () => {
  it('leaves no name, email or ticket text in any API answer, database row or R2 object', async () => {
    const agent = await signInAs('agent')
    await addEndpoint()
    const app = await newApp()
    const data = await contactWithData(app, agent)
    // Another Contact of the same Application keeps its data: the scan below must find it.
    const other = await created(await postJson('/api/v1/tickets', { ticket_type_id: bug, title: marker('KeepMe'), fields: { page_or_feature: 'Cart' }, contact: { external_id: marker('cus'), name: 'Kept Person', email: 'kept@shop.example' } }, bearer(app.key)))
    const otherFile = await (await upload(other.ref, bearer(app.key), 'kept.txt', marker('KeptFile'))).json() as { id: string }

    // Sanity: the scans see the data before Erasure.
    expect((await databaseHits(data.strings)).length).toBeGreaterThan(0)
    expect(await bucketHits([data.secret.fileText])).toHaveLength(1)
    const auditBefore = await env.DB.prepare('SELECT id, ticket_number, principal_id, application_id, channel, action, field_key, comment_id FROM audit_log WHERE ticket_number IN (?, ?) ORDER BY id').bind(data.one.number, data.two.number).all()

    const contactId = data.one.requester.id
    expect((await call(`/api/v1/contacts/${contactId}`, { method: 'DELETE', headers: bearer(app.key) })).status).toBe(204)

    expect(await databaseHits(data.strings)).toEqual([])
    expect(await bucketHits(data.strings)).toEqual([])
    expect(await env.FILES.head(data.file.id)).toBeNull()
    // The other Contact is untouched.
    expect(await databaseHits([other.title, 'kept@shop.example'])).not.toEqual([])
    expect(await env.FILES.head(otherFile.id)).not.toBeNull()

    // API answers, on every route that shows these tickets.
    const answers: string[] = []
    const read = async (path: string, headers: HeadersInit) => {
      const res = await get(path, headers)
      answers.push(await res.clone().text())
      return res
    }
    for (const t of [data.one, data.two]) {
      for (const headers of [as(admin), as(agent), bearer(app.key)]) {
        expect((await read(`/api/v1/tickets/${t.ref}`, headers)).status).toBe(200)
        await read(`/api/v1/tickets/${t.ref}/comments`, headers)
        await read(`/api/v1/tickets/${t.ref}/activity`, headers)
        await read(`/api/v1/tickets/${t.ref}/attachments`, headers)
      }
    }
    for (const s of data.strings) {
      await read(`/api/v1/tickets?q=${encodeURIComponent(s)}`, as(admin))
      await read(`/api/v1/tickets?q=${encodeURIComponent(s)}`, bearer(app.key))
    }
    await read('/api/v1/tickets', bearer(app.key))
    await read(`/api/v1/contacts?email=${encodeURIComponent(data.person.email)}`, as(admin))
    await read(`/api/v1/contacts?external_id=${encodeURIComponent(data.person.external_id)}`, as(admin))
    await read('/api/v1/notifications?limit=100', as(agent))
    await read('/api/v1/notifications?limit=100', as(admin))
    const hooks = await (await read('/api/v1/webhooks', as(admin))).json() as { data: { id: string }[] }
    for (const h of hooks.data) {
      const { data: list } = await (await read(`/api/v1/webhooks/${h.id}/deliveries`, as(admin))).json() as { data: { id: number }[] }
      for (const d of list) await read(`/api/v1/webhooks/${h.id}/deliveries/${d.id}`, as(admin))
    }
    expect((await get(`/api/v1/attachments/${data.file.id}`, as(admin))).status).toBe(404)
    const all = answers.join('\n').toLowerCase()
    expect(data.strings.filter(s => all.includes(s.toLowerCase()))).toEqual([])

    // The tickets stay with their numbers, Statuses and audit facts.
    const one = await (await get(`/api/v1/tickets/${data.one.ref}`, as(admin))).json() as Ticket
    expect(one).toMatchObject({ number: data.one.number, ref: data.one.ref, title: '[erased]', description: '', fields: {}, status: { key: 'in_progress' } })
    expect(one.requester).toMatchObject({ kind: 'contact', id: contactId, name: '[erased]', email: '[erased]' })
    const auditAfter = await env.DB.prepare('SELECT id, ticket_number, principal_id, application_id, channel, action, field_key, comment_id FROM audit_log WHERE ticket_number IN (?, ?) ORDER BY id').bind(data.one.number, data.two.number).all()
    expect(auditAfter.results.slice(0, auditBefore.results.length)).toEqual(auditBefore.results)
    expect(auditAfter.results.slice(auditBefore.results.length).map(r => [r.ticket_number, r.action, r.application_id])).toEqual([[data.one.number, 'ticket_erased', app.id], [data.two.number, 'ticket_erased', app.id]])
    const values = await env.DB.prepare('SELECT count(*) AS n FROM audit_log WHERE ticket_number IN (?, ?) AND (before IS NOT NULL OR after IS NOT NULL)').bind(data.one.number, data.two.number).first<{ n: number }>()
    expect(values!.n).toBe(0)
    const comments = await env.DB.prepare('SELECT body FROM comment WHERE ticket_number = ?').bind(data.one.number).all<{ body: string }>()
    expect(comments.results.map(c => c.body)).toEqual(['[erased]', '[erased]'])

    // A new ticket with the old external ID makes a new Contact; the erased tickets stay erased.
    const again = await created(await postJson('/api/v1/tickets', { ticket_type_id: bug, title: 'New request', fields: { page_or_feature: 'Cart' }, contact: { ...data.person, name: 'Zora Again' } }, bearer(app.key)))
    expect(again.requester.id).not.toBe(contactId)
    expect((await (await get(`/api/v1/tickets/${data.one.ref}`, as(admin))).json() as Ticket).requester.name).toBe('[erased]')
    // A second call answers the same and changes nothing more.
    expect((await call(`/api/v1/contacts/${contactId}`, { method: 'DELETE', headers: bearer(app.key) })).status).toBe(204)
  })

  it('finishes the file deletion on a second run when R2 fails, and the files are unreachable meanwhile', async () => {
    const agent = await signInAs('agent')
    const app = await newApp()
    const data = await contactWithData(app, agent)
    vi.spyOn(env.FILES, 'delete').mockRejectedValueOnce(new Error('R2 is down'))
    const failed = await call(`/api/v1/contacts/${data.one.requester.id}`, { method: 'DELETE', headers: bearer(app.key) })
    expect(failed.status).toBe(500)
    // The database part is done, so nobody can reach the file that is still in R2.
    expect(await env.FILES.head(data.file.id)).not.toBeNull()
    expect((await get(`/api/v1/attachments/${data.file.id}`, as(admin))).status).toBe(404)
    expect((await (await get(`/api/v1/tickets/${data.one.ref}/attachments`, as(admin))).json() as { data: unknown[] }).data).toEqual([])
    expect(await databaseHits(data.strings)).toEqual([])

    expect((await call(`/api/v1/contacts/${data.one.requester.id}`, { method: 'DELETE', headers: bearer(app.key) })).status).toBe(204)
    expect(await env.FILES.head(data.file.id)).toBeNull()
  })

  it('lets an Application erase only its own Contacts, and an Admin any Contact', async () => {
    const [agent, requester] = await Promise.all([signInAs('agent'), signInAs('requester')])
    const [owner, stranger] = await Promise.all([newApp(), newApp()])
    const t = await created(await postJson('/api/v1/tickets', { ticket_type_id: bug, title: 'Where is my parcel', fields: { page_or_feature: 'Cart' }, contact: { external_id: marker('cus'), name: 'Bea Ortiz', email: 'bea@shop.example' } }, bearer(owner.key)))
    const id = t.requester.id
    const refused = await call(`/api/v1/contacts/${id}`, { method: 'DELETE', headers: bearer(stranger.key) })
    expect(refused.status).toBe(404)
    expect((await refused.json() as ErrorBody).error.code).toBe('NOT_FOUND')
    expect((await call('/api/v1/contacts/999999', { method: 'DELETE', headers: bearer(owner.key) })).status).toBe(404)
    expect((await call('/api/v1/contacts/abc', { method: 'DELETE', headers: bearer(owner.key) })).status).toBe(404)
    expect((await call(`/api/v1/contacts/${id}`, { method: 'DELETE', headers: as(agent) })).status).toBe(403)
    expect((await call(`/api/v1/contacts/${id}`, { method: 'DELETE', headers: as(requester) })).status).toBe(403)
    expect((await call(`/api/v1/contacts/${id}`, { method: 'DELETE' })).status).toBe(401)
    expect((await (await get(`/api/v1/tickets/${t.ref}`, as(admin))).json() as Ticket).requester.name).toBe('Bea Ortiz')

    // The Admin finds the Contact by email or external ID, then erases it.
    expect((await get('/api/v1/contacts', as(admin))).status).toBe(422)
    expect((await get('/api/v1/contacts?email=bea@shop.example', as(agent))).status).toBe(403)
    expect((await get('/api/v1/contacts?email=bea@shop.example', bearer(owner.key))).status).toBe(403)
    const found = await (await get('/api/v1/contacts?email=BEA@shop.example', as(admin))).json() as { data: { id: number, ticket_count: number, erased_at: string | null }[], users: unknown[] }
    expect(found.data).toContainEqual(expect.objectContaining({ id, ticket_count: 1, erased_at: null }))
    expect(found.users).toEqual([])
    // An internal User is not a Contact: the answer says so, and Erasure does not touch Users.
    const user = await (await get(`/api/v1/contacts?email=${encodeURIComponent(agent.user.email)}`, as(admin))).json() as { data: unknown[], users: { id: string }[] }
    expect(user).toMatchObject({ data: [], users: [{ id: agent.user.id }] })

    expect((await call(`/api/v1/contacts/${id}`, { method: 'DELETE', headers: as(admin) })).status).toBe(204)
    expect((await (await get(`/api/v1/tickets/${t.ref}`, bearer(owner.key))).json() as Ticket).requester).toMatchObject({ name: '[erased]', email: '[erased]' })
  })
})
