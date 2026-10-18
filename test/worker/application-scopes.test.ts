import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { adminAuditOf, call, createRestrictedType, postJson, signInAs, typeId } from './helpers'

// Issue 42: a scope (own or all) for each Application permission.

type Session = Awaited<ReturnType<typeof signInAs>>
type Scopes = { read: 'own' | 'all', update: 'own' | 'all', comment: 'own' | 'all' }
interface Ticket { number: number, ref: string, requester: Record<string, unknown>, assignee: unknown, assigned: boolean, team?: unknown, restricted: boolean, allowed_actions: string[], status: { key: string } }
interface Actor { kind: string, application?: { id: number, name: string } }
interface Comment { id: string, body: string, visibility: string, author: Actor }
interface Item { type: 'event' | 'comment', action?: string, principal?: Actor, comment?: Comment, before?: unknown, after?: unknown }
interface ErrorBody { error: { code: string, message: string, details: { key: string, reason: string }[] | null } }

const ALL = ['tickets:create', 'tickets:read', 'tickets:update', 'comments:create']
const OWN: Scopes = { read: 'own', update: 'own', comment: 'own' }

let admin: Session
let agent: Session
let requester: Session
let gen: number
let bug: number

beforeAll(async () => {
  ;[admin, agent, requester] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('requester')])
  ;[gen, bug] = await Promise.all([typeId(admin.cookie, 'GEN'), typeId(admin.cookie, 'BUG')])
})

const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const cookie = (s: Session) => ({ cookie: s.cookie })
const patchApp = (id: number, body: unknown, headers: HeadersInit = cookie(admin)) => call(`/api/v1/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers })
const patch = (ref: string, body: unknown, headers: HeadersInit) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers })
const comment = (ref: string, body: unknown, headers: HeadersInit) => postJson(`/api/v1/tickets/${ref}/comments`, body, headers)

let counter = 0
async function newApp(scopes: Scopes = OWN, includeRestricted = false, permissions = ALL) {
  const res = await postJson('/api/v1/applications', { name: `Scoped ${Date.now()} ${counter++}`, permissions, ticket_type_ids: [gen] }, cookie(admin))
  expect(res.status).toBe(201)
  const app = await res.json() as { id: number, name: string }
  if (scopes !== OWN || includeRestricted) {
    const set = await patchApp(app.id, { ticket_scopes: scopes, include_restricted: includeRestricted })
    expect(set.status, await set.clone().text()).toBe(200)
  }
  const { key } = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'Test' }, cookie(admin))).json() as { key: string }
  return { ...app, key }
}

async function appTicket(key: string, title = 'Card declined') {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: gen, title, contact: { external_id: 'cus_1', name: 'Ana Lima', email: 'ana@shop.example' } }, bearer(key))
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Ticket
}

async function userTicket(session: Session, typeIdValue = bug, title = `Export fails ${crypto.randomUUID()}`) {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: typeIdValue, title, fields: typeIdValue === bug ? { page_or_feature: 'Reports' } : {} }, cookie(session))
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Ticket
}

/**
 * The one-ticket rule (`canRead`, through GET) and the SQL rule (`readableTickets`, through the list and search) must
 * agree. Returns the one answer, and fails when they differ.
 */
async function reads(key: string, t: Ticket): Promise<boolean> {
  const one = await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(key) })
  const listed = await (await call('/api/v1/tickets?limit=200', { headers: bearer(key) })).json() as { data: Ticket[] }
  const searched = await (await call(`/api/v1/tickets?q=${t.ref}`, { headers: bearer(key) })).json() as { data: Ticket[] }
  const answers = [one.status === 200, listed.data.some(x => x.number === t.number), searched.data.some(x => x.number === t.number)]
  expect(one.status === 200 || one.status === 404, `status ${one.status}`).toBe(true)
  expect(new Set(answers).size, `GET, list and search disagree for ${t.ref}: ${answers.join(', ')}`).toBe(1)
  return answers[0]!
}

describe('read scope', () => {
  it('own: reads only its own tickets, by GET, list and search', async () => {
    const [a, b] = [await newApp(), await newApp()]
    const mine = await appTicket(a.key)
    const theirs = await appTicket(b.key)
    const users = await userTicket(requester)
    expect(await reads(a.key, mine)).toBe(true)
    expect(await reads(a.key, theirs)).toBe(false)
    expect(await reads(a.key, users)).toBe(false)
  })

  it('all: reads another Application\'s ticket and a User\'s ticket; a deleted ticket stays hidden', async () => {
    const [a, b] = [await newApp({ read: 'all', update: 'own', comment: 'own' }), await newApp()]
    const theirs = await appTicket(b.key)
    const users = await userTicket(requester)
    const gone = await userTicket(requester)
    expect((await call(`/api/v1/tickets/${gone.ref}`, { method: 'DELETE', headers: cookie(admin) })).status).toBe(204)
    expect(await reads(a.key, theirs)).toBe(true)
    expect(await reads(a.key, users)).toBe(true)
    expect(await reads(a.key, gone)).toBe(false)
    // The other Application keeps its own scope.
    expect(await reads(b.key, users)).toBe(false)
    // "me" is still the tickets it created.
    const mine = await appTicket(a.key)
    const me = await (await call('/api/v1/tickets?requester=me', { headers: bearer(a.key) })).json() as { data: Ticket[] }
    expect(me.data.map(t => t.number)).toEqual([mine.number])
  })

  it('all: a Restricted ticket stays hidden until "Include Restricted tickets" is on', async () => {
    const restrictedType = await createRestrictedType()
    const a = await newApp({ read: 'all', update: 'own', comment: 'own' })
    const secret = await userTicket(requester, restrictedType)
    expect(await reads(a.key, secret)).toBe(false)
    expect((await patchApp(a.id, { include_restricted: true })).status).toBe(200)
    expect(await reads(a.key, secret)).toBe(true)
    const seen = await (await call(`/api/v1/tickets/${secret.ref}`, { headers: bearer(a.key) })).json() as Ticket
    expect(seen.restricted).toBe(true)
    // An own Application never reads it, also with the flag in the row.
    const own = await newApp()
    await env.DB.prepare('UPDATE application SET include_restricted = 1 WHERE id = ?').bind(own.id).run()
    expect(await reads(own.key, secret)).toBe(false)
  })

  it('fails closed: a stored `all` without tickets:read reads nothing of others', async () => {
    const a = await newApp({ read: 'all', update: 'own', comment: 'own' })
    const users = await userTicket(requester)
    await env.DB.prepare('UPDATE application SET permissions = ? WHERE id = ?').bind(JSON.stringify(['tickets:create']), a.id).run()
    expect((await call(`/api/v1/tickets/${users.ref}`, { headers: bearer(a.key) })).status).toBe(404)
    expect((await call('/api/v1/tickets', { headers: bearer(a.key) })).status).toBe(403)
  })

  it('keeps the Application view in all scope: no assignee, no Team, no Internal Comments, staff and Users as support', async () => {
    const a = await newApp({ read: 'all', update: 'all', comment: 'all' })
    const t = await userTicket(requester)
    expect((await patch(t.ref, { assignee_id: agent.user.id }, cookie(agent))).status).toBe(200)
    expect((await comment(t.ref, { body: 'Staff only note', visibility: 'internal' }, cookie(agent))).status).toBe(201)
    expect((await comment(t.ref, { body: 'We are on it', visibility: 'public' }, cookie(agent))).status).toBe(201)

    const res = await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(a.key) })
    const seen = await res.clone().json() as Ticket
    expect(seen).toMatchObject({ assignee: null, assigned: true, requester: { kind: 'support' } })
    expect(seen).not.toHaveProperty('team')
    const list = await (await call(`/api/v1/tickets?q=${t.ref}`, { headers: bearer(a.key) })).json() as { data: Ticket[] }
    expect(list.data[0]).toMatchObject({ assignee: null, requester: { kind: 'support' } })
    expect(list.data[0]).not.toHaveProperty('team')

    const comments = await (await call(`/api/v1/tickets/${t.ref}/comments`, { headers: bearer(a.key) })).json() as { data: Comment[] }
    expect(comments.data.map(c => [c.body, c.author.kind])).toEqual([['We are on it', 'support']])
    const activity = await call(`/api/v1/tickets/${t.ref}/activity`, { headers: bearer(a.key) })
    const items = (await activity.clone().json() as { data: Item[] }).data
    expect(items.some(i => i.comment?.visibility === 'internal')).toBe(false)
    expect(items.filter(i => i.type === 'event').every(i => i.principal?.kind === 'support')).toBe(true)
    for (const body of [await res.text(), await activity.text(), JSON.stringify(list)]) {
      for (const secret of [agent.user.email, agent.user.id, requester.user.email, requester.user.id, 'Staff only note']) expect(body).not.toContain(secret)
    }
  })
})

describe('update and comment scopes', () => {
  it('read: all with update and comment own: refuses writes on a ticket it did not create, allows them on its own', async () => {
    const a = await newApp({ read: 'all', update: 'own', comment: 'own' })
    const t = await userTicket(requester)
    const mine = await appTicket(a.key)
    for (const res of [await patch(t.ref, { status: 'in_progress' }, bearer(a.key)), await comment(t.ref, { body: 'Hi' }, bearer(a.key)), await postJson(`/api/v1/tickets/${t.ref}/cancel`, {}, bearer(a.key))]) {
      expect(res.status, await res.clone().text()).toBe(403)
    }
    const upload = await call(`/api/v1/tickets/${t.ref}/attachments`, { method: 'PUT', body: new TextEncoder().encode('log'), headers: { 'x-filename': 'log.txt', 'content-type': 'text/plain', ...bearer(a.key) } })
    expect(upload.status).toBe(403)
    expect((await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(a.key) })).status).toBe(200)
    expect((await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(a.key) }).then(r => r.json()) as Ticket).allowed_actions).toEqual([])
    // Its own ticket: as before.
    expect((await comment(mine.ref, { body: 'Hi' }, bearer(a.key))).status).toBe(201)
    expect((await postJson(`/api/v1/tickets/${mine.ref}/cancel`, {}, bearer(a.key))).status).toBe(200)
    expect((await patch(mine.ref, { status: 'open' }, bearer(a.key))).status).toBe(403)
  })

  it('update and comment all: changes and comments on a User\'s ticket, as the Application itself', async () => {
    const a = await newApp({ read: 'all', update: 'all', comment: 'all' })
    const t = await userTicket(requester)
    expect((await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(a.key) }).then(r => r.json()) as Ticket).allowed_actions).toEqual(['change_status', 'change_priority', 'edit_fields', 'comment'])

    const changed = await patch(t.ref, { status: 'in_progress', priority: 'high' }, bearer(a.key))
    expect(changed.status, await changed.clone().text()).toBe(200)
    expect((await changed.json() as Ticket).status.key).toBe('in_progress')
    const posted = await comment(t.ref, { body: 'Logged 2 hours.' }, bearer(a.key))
    expect(posted.status).toBe(201)
    const self = { kind: 'application', application: { id: a.id, name: a.name } }
    expect(await posted.json()).toMatchObject({ visibility: 'public', author: self })
    // Never an Internal Comment, never staff actions or Requester actions.
    expect((await comment(t.ref, { body: 'x', visibility: 'internal' }, bearer(a.key))).status).toBe(403)
    for (const body of [{ assignee_id: agent.user.id }, { description: 'x' }]) expect((await patch(t.ref, body, bearer(a.key))).status).toBe(403)
    expect((await postJson(`/api/v1/tickets/${t.ref}/cancel`, {}, bearer(a.key))).status).toBe(403)

    const audit = await env.DB.prepare('SELECT action, principal_id, application_id FROM audit_log WHERE ticket_number = ? AND application_id IS NOT NULL ORDER BY id').bind(t.number).all()
    expect(audit.results).toEqual(['status_changed', 'priority_changed', 'comment_added'].map(action => ({ action, principal_id: null, application_id: a.id })))

    // Staff see the Application by name.
    const forAgent = (await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: cookie(agent) })).json() as { data: Item[] }).data
    expect(forAgent.find(i => i.action === 'status_changed')?.principal).toEqual(self)
    expect(forAgent.find(i => i.type === 'comment')?.comment?.author).toEqual(self)
    const forApp = (await (await call(`/api/v1/tickets/${t.ref}/comments`, { headers: bearer(a.key) })).json() as { data: Comment[] }).data
    expect(forApp.map(c => c.author)).toEqual([self])

    // The Requester's notices name the Application.
    const notices = await (await call('/api/v1/notifications', { headers: cookie(requester) })).json() as { data: { head: string, ticket: { ref: string } | null }[] }
    const heads = notices.data.filter(n => n.ticket?.ref === t.ref).map(n => n.head)
    expect(heads).toContain(`${a.name} changed ${t.ref} to In progress`)
    expect(heads).toContain(`${a.name} replied on ${t.ref}`)
  })

  it('update all on its own ticket still acts for its Contact', async () => {
    const a = await newApp({ read: 'all', update: 'all', comment: 'own' })
    const mine = await appTicket(a.key)
    expect((await patch(mine.ref, { status: 'in_progress' }, bearer(a.key))).status).toBe(200)
    const items = (await (await call(`/api/v1/tickets/${mine.ref}/activity`, { headers: cookie(agent) })).json() as { data: Item[] }).data
    expect(items.find(i => i.action === 'status_changed')?.principal).toMatchObject({ kind: 'contact', application: { id: a.id } })
  })

  it('needs the permission too: a stored update scope without tickets:update changes nothing', async () => {
    const a = await newApp({ read: 'all', update: 'all', comment: 'all' })
    const t = await userTicket(requester)
    await env.DB.prepare('UPDATE application SET permissions = ? WHERE id = ?').bind(JSON.stringify(['tickets:read']), a.id).run()
    expect((await patch(t.ref, { status: 'in_progress' }, bearer(a.key))).status).toBe(403)
    expect((await comment(t.ref, { body: 'Hi' }, bearer(a.key))).status).toBe(403)
  })
})

describe('files, Fields and revert in all scopes (reviewer findings)', () => {
  const upload = (ref: string, headers: HeadersInit) => call(`/api/v1/tickets/${ref}/attachments`, { method: 'PUT', body: new TextEncoder().encode('log line'), headers: { 'x-filename': 'log.txt', 'content-type': 'text/plain', ...headers } })

  it('lists the files of a readable ticket by the read rule, without the uploader\'s User ID', async () => {
    const a = await newApp({ read: 'all', update: 'own', comment: 'own' })
    const t = await userTicket(requester)
    expect((await upload(t.ref, cookie(agent))).status).toBe(201)
    const list = await call(`/api/v1/tickets/${t.ref}/attachments`, { headers: bearer(a.key) })
    expect(list.status).toBe(200)
    const body = await list.text()
    expect((JSON.parse(body) as { data: { uploader_id: unknown, filename: string }[] }).data).toMatchObject([{ filename: 'log.txt', uploader_id: null }])
    expect(body).not.toContain(agent.user.id)
    // An own Application still gets 404 for the same ticket.
    expect((await call(`/api/v1/tickets/${t.ref}/attachments`, { headers: bearer((await newApp()).key) })).status).toBe(404)
  })

  it('adds a file to a User\'s ticket with update: all', async () => {
    const a = await newApp({ read: 'all', update: 'all', comment: 'own' })
    const t = await userTicket(requester)
    const res = await upload(t.ref, bearer(a.key))
    expect(res.status, await res.clone().text()).toBe(201)
    const row = await env.DB.prepare('SELECT application_id, principal_id FROM audit_log WHERE ticket_number = ? AND action = \'attachment_added\'').bind(t.number).first()
    expect(row).toEqual({ application_id: a.id, principal_id: null })
  })

  it('hides the value of a `user` Field in the ticket and in Activity', async () => {
    const type = await env.DB.prepare(`INSERT INTO ticket_type (name, prefix, description, team_id, visibility, created_at)
      VALUES (?, ?, 'Staff work.', (SELECT id FROM team WHERE name = 'Support'), 'requester', ?) RETURNING id`).bind(`Owned ${crypto.randomUUID()}`, `W${Array.from(crypto.getRandomValues(new Uint8Array(4)), b => String.fromCharCode(65 + (b % 26))).join('')}`, Date.now()).first<{ id: number }>()
    await env.DB.prepare('INSERT INTO schema_version (ticket_type_id, version, fields, created_at) VALUES (?, 1, ?, ?)')
      .bind(type!.id, JSON.stringify([{ key: 'owner', label: 'Owner', type: 'user', required: false, help: '' }, { key: 'note', label: 'Note', type: 'short_text', required: false, help: '' }]), Date.now()).run()
    const created = await postJson('/api/v1/tickets', { ticket_type_id: type!.id, title: 'Staff task', fields: { note: 'hi' } }, cookie(agent))
    expect(created.status, await created.clone().text()).toBe(201)
    const t = await created.json() as Ticket
    expect((await patch(t.ref, { fields: { owner: agent.user.id } }, cookie(agent))).status).toBe(200)

    const a = await newApp({ read: 'all', update: 'own', comment: 'own' })
    const res = await call(`/api/v1/tickets/${t.ref}`, { headers: bearer(a.key) })
    expect((await res.clone().json() as { fields: Record<string, unknown> }).fields).toEqual({ note: 'hi' })
    const activity = await call(`/api/v1/tickets/${t.ref}/activity`, { headers: bearer(a.key) })
    const items = (await activity.clone().json() as { data: Item[] }).data
    expect(items.find(i => i.action === 'field_changed')).toMatchObject({ before: null, after: 'Support' })
    for (const body of [await res.text(), await activity.text()]) expect(body).not.toContain(agent.user.id)
    // Staff still see it.
    expect((await (await call(`/api/v1/tickets/${t.ref}`, { headers: cookie(agent) })).json() as { fields: Record<string, unknown> }).fields.owner).toBe(agent.user.id)
  })

  it('reverts a Status change with update: all, and refuses it with update: own', async () => {
    const [all, own] = [await newApp({ read: 'all', update: 'all', comment: 'own' }), await newApp({ read: 'all', update: 'own', comment: 'own' })]
    const t = await userTicket(requester)
    expect((await patch(t.ref, { status: 'in_progress' }, cookie(agent))).status).toBe(200)
    const items = (await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: bearer(all.key) })).json() as { data: (Item & { id: string, revertible: boolean })[] }).data
    const entry = items.find(i => i.action === 'status_changed')!
    expect(entry.revertible).toBe(true)
    expect((await postJson(`/api/v1/tickets/${t.ref}/activity/${entry.id}/revert`, {}, bearer(own.key))).status).toBe(403)
    const res = await postJson(`/api/v1/tickets/${t.ref}/activity/${entry.id}/revert`, {}, bearer(all.key))
    expect(res.status, await res.clone().text()).toBe(200)
    expect((await res.json() as Ticket).status.key).toBe('open')
    const after = (await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: cookie(agent) })).json() as { data: Item[] }).data
    expect(after.at(-1)?.principal).toEqual({ kind: 'application', application: { id: all.id, name: all.name } })
  })

  it('refuses reopen of a ticket it did not create, also with update: all', async () => {
    const a = await newApp({ read: 'all', update: 'all', comment: 'all' })
    const t = await userTicket(requester)
    expect((await patch(t.ref, { status: 'resolved' }, cookie(agent))).status).toBe(200)
    const res = await postJson(`/api/v1/tickets/${t.ref}/reopen`, {}, bearer(a.key))
    expect(res.status).toBe(403)
    expect((await res.json() as ErrorBody).error.message).toBe('An Application can reopen only the tickets it created.')
  })
})

describe('Admin settings', () => {
  it('refuses scopes that break the rules (422)', async () => {
    const a = await newApp()
    const cases: [unknown, string][] = [
      [{ ticket_scopes: { read: 'own', update: 'all', comment: 'own' } }, 'ticket_scopes.update'],
      [{ ticket_scopes: { read: 'own', update: 'own', comment: 'all' } }, 'ticket_scopes.comment'],
      [{ include_restricted: true }, 'include_restricted'],
      [{ permissions: ['tickets:create'], ticket_scopes: { read: 'all', update: 'own', comment: 'own' } }, 'ticket_scopes.read'],
      [{ ticket_scopes: { read: 'all' } }, 'ticket_scopes'],
      [{ ticket_scopes: { read: 'everything', update: 'own', comment: 'own' } }, 'ticket_scopes'],
    ]
    for (const [body, key] of cases) {
      const res = await patchApp(a.id, body)
      expect(res.status, JSON.stringify(body)).toBe(422)
      expect((await res.json() as ErrorBody).error.details?.map(d => d.key).join(' '), JSON.stringify(body)).toContain(key)
    }
    // Removing a permission cannot leave its `all` scope behind.
    expect((await patchApp(a.id, { ticket_scopes: { read: 'all', update: 'own', comment: 'all' } })).status).toBe(200)
    expect((await patchApp(a.id, { permissions: ['tickets:read'] })).status).toBe(422)
    const detail = await (await call(`/api/v1/applications/${a.id}`, { headers: cookie(admin) })).json() as { permissions: string[], ticket_scopes: Scopes, include_restricted: boolean }
    expect(detail).toMatchObject({ permissions: ALL, ticket_scopes: { read: 'all', update: 'own', comment: 'all' }, include_restricted: false })
  })

  it('is for Admins only, and writes an audit entry with the old and new values', async () => {
    const a = await newApp()
    const body = { ticket_scopes: { read: 'all', update: 'own', comment: 'own' }, include_restricted: true }
    expect((await patchApp(a.id, body, cookie(agent))).status).toBe(403)
    expect((await patchApp(a.id, body, bearer(a.key))).status).toBe(403)
    expect(await adminAuditOf('application', a.id)).toEqual([])

    expect((await patchApp(a.id, body)).status).toBe(200)
    // The same values again change nothing and write nothing.
    expect((await patchApp(a.id, body)).status).toBe(200)
    const entries = await adminAuditOf('application', a.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      action: 'application_changed',
      principal_id: admin.user.id,
      before: { ticket_scopes: OWN, include_restricted: false },
      after: body,
    })
  })
})
