import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { assertMayCreate, authorize, authorizeAttach, authorizeAttachmentRead, authorizeList, authorizeListAssignees, authorizeTicketApps, authorizeUnattachedUpload, canSeeTicketType, isAdmin, isTicketAppRoute, type PolicyTicket } from '../../server/utils/policy'
import { db } from '../../server/utils/services'
import { contextToken } from '../../server/utils/ticket-apps'
import { getTicket, type UserPrincipal } from '../../server/utils/tickets'
import { adminAuditOf, call, createRestrictedType, getMcpToken, postJson, signInAs, typeId } from './helpers'

// Issue 35: a Ticket App's backend changes its ticket through the REST API with the context token.

type Session = Awaited<ReturnType<typeof signInAs>>
type Access = 'read' | 'comment' | 'update'
interface App { id: number, name: string, access: Access }
interface Ticket { number: number, ref: string }

const APP_ORIGIN = 'http://localhost:9935'
const h = (s: Session) => ({ cookie: s.cookie })
const bearer = (jwt: string) => ({ authorization: `Bearer ${jwt}` })

let admin: Session
let agent: Session
let requester: Session
let gen: number
let counter = 0

beforeAll(async () => {
  ;[admin, agent, requester] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('requester')])
  gen = await typeId(admin.cookie, 'GEN')
})

async function newApp(access: Access, body: Record<string, unknown> = {}): Promise<App> {
  const res = await postJson('/api/v1/admin/ticket-apps', { name: `Orders ${counter++}`, url: `${APP_ORIGIN}/app.html`, position: 'sidebar', access, ...body }, h(admin))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<App>
}

async function raise(s: Session = requester, ticketTypeId = gen): Promise<Ticket> {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: ticketTypeId, title: `Charged twice ${counter++}`, description: 'Order 5521.' }, h(s))
  expect(res.status, await res.clone().text()).toBe(201)
  return res.json() as Promise<Ticket>
}

async function tokenFor(s: Session, t: Ticket, app: App): Promise<string> {
  const res = await call(`/api/v1/tickets/${t.ref}/apps/${app.id}/token`, { method: 'POST', headers: h(s) })
  expect(res.status, await res.clone().text()).toBe(200)
  return ((await res.json()) as { token: string }).token
}

const get = (path: string, jwt: string) => call(path, { headers: bearer(jwt) })
const comment = (t: Ticket, jwt: string, body: Record<string, unknown> = { body: 'Refund issued.' }) => postJson(`/api/v1/tickets/${t.ref}/comments`, body, bearer(jwt))
const patch = (t: Ticket, jwt: string, body: Record<string, unknown>) => call(`/api/v1/tickets/${t.ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: bearer(jwt) })

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code
}

describe('Ticket App writes: scopes', () => {
  it('a read token reads the ticket, comments and activity, and gets 403 on comment and change', async () => {
    const t = await raise()
    const jwt = await tokenFor(agent, t, await newApp('read'))
    for (const path of [`/api/v1/tickets/${t.ref}`, `/api/v1/tickets/${t.ref}/comments`, `/api/v1/tickets/${t.ref}/activity`]) {
      expect((await get(path, jwt)).status, path).toBe(200)
    }
    const detail = await (await get(`/api/v1/tickets/${t.ref}`, jwt)).json() as { allowed_actions: string[] }
    expect(detail.allowed_actions).toEqual([])
    const refused = await comment(t, jwt)
    expect(refused.status).toBe(403)
    expect(await codeOf(refused)).toBe('FORBIDDEN')
    expect((await patch(t, jwt, { status: 'resolved' })).status).toBe(403)
  })

  it('a comment token adds a comment and gets 403 on a change', async () => {
    const t = await raise()
    const jwt = await tokenFor(agent, t, await newApp('comment'))
    const added = await comment(t, jwt, { body: 'Refund issued.', visibility: 'internal' })
    expect(added.status, await added.clone().text()).toBe(201)
    expect(await added.json()).toMatchObject({ visibility: 'internal', channel: 'app', author: { kind: 'user', id: agent.user.id } })
    expect((await comment(t, jwt, { body: 'Your refund is on the way.', visibility: 'public' })).status).toBe(201)
    expect((await patch(t, jwt, { priority: 'high' })).status).toBe(403)
  })

  it('an update token changes Status, Priority, assignee and Fields, and gets 403 on everything else', async () => {
    const t = await raise()
    const jwt = await tokenFor(agent, t, await newApp('update'))
    const changed = await patch(t, jwt, { status: 'resolved', priority: 'high', assignee_id: agent.user.id })
    expect(changed.status, await changed.clone().text()).toBe(200)
    expect(await changed.json()).toMatchObject({ status: { key: 'resolved' }, priority: 'high', assignee: { id: agent.user.id } })
    expect((await comment(t, jwt)).status).toBe(201)

    const bug = await typeId(admin.cookie, 'BUG')
    const team = (await env.DB.prepare('SELECT id FROM team LIMIT 1').first<{ id: number }>())!.id
    expect((await call(`/api/v1/tickets/${t.ref}/type`, { method: 'PUT', body: JSON.stringify({ ticket_type_id: bug }), headers: bearer(jwt) })).status).toBe(403)
    expect((await postJson(`/api/v1/tickets/${t.ref}/cancel`, {}, bearer(jwt))).status).toBe(403)
    const entry = await env.DB.prepare('SELECT id FROM audit_log WHERE ticket_number = ? AND action = \'status_changed\'').bind(t.number).first<{ id: number }>()
    expect((await postJson(`/api/v1/tickets/${t.ref}/activity/${entry!.id}/revert`, {}, bearer(jwt))).status).toBe(403)
    expect((await patch(t, jwt, { team_id: team })).status).toBe(403)
    expect((await patch(t, jwt, { description: 'New text.' })).status).toBe(403)
    expect((await call(`/api/v1/tickets/${t.ref}`, { method: 'DELETE', headers: bearer(jwt) })).status).toBe(403)
    // A route for the web session only reads no Bearer token at all.
    expect((await postJson(`/api/v1/tickets/${t.ref}/participants`, { user_id: admin.user.id }, bearer(jwt))).status).toBe(401)
  })

  it('uses the lower of the token access and the app access now', async () => {
    const t = await raise()
    const app = await newApp('update')
    const jwt = await tokenFor(agent, t, app)
    expect((await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: JSON.stringify({ access: 'read' }), headers: h(admin) })).status).toBe(200)
    expect((await comment(t, jwt)).status).toBe(403)

    const low = await newApp('read')
    const old = await tokenFor(agent, t, low)
    await call(`/api/v1/admin/ticket-apps/${low.id}`, { method: 'PATCH', body: JSON.stringify({ access: 'update' }), headers: h(admin) })
    expect((await comment(t, old)).status).toBe(403)
    expect((await comment(t, await tokenFor(agent, t, low))).status).toBe(201)

    const entries = await adminAuditOf('ticket_app', app.id)
    expect(entries.at(-1)).toMatchObject({ action: 'ticket_app_changed', before: { access: 'update' }, after: { access: 'read' } })
  })
})

describe('Ticket App writes: one ticket only', () => {
  it('answers 404 for another ticket, and 403 for lists, search, people, admin and type routes', async () => {
    const t = await raise()
    const other = await raise()
    const jwt = await tokenFor(admin, t, await newApp('update'))
    expect((await get(`/api/v1/tickets/${other.ref}`, jwt)).status).toBe(404)
    expect((await get(`/api/v1/tickets/${other.ref}/comments`, jwt)).status).toBe(404)
    expect((await comment(other, jwt)).status).toBe(404)
    expect((await patch(other, jwt, { status: 'resolved' })).status).toBe(404)
    // A bare number names the same ticket.
    expect((await get(`/api/v1/tickets/${t.number}`, jwt)).status).toBe(200)

    for (const path of ['/api/v1/tickets', '/api/v1/tickets?q=Charged', '/api/v1/tickets/similar?title=Charged%20twice', '/api/v1/tickets/deleted',
      '/api/v1/users', '/api/v1/applications', '/api/v1/assignees', '/api/v1/admin/ticket-apps', '/api/v1/ticket-types',
      `/api/v1/tickets/${t.ref}/attachments`, `/api/v1/tickets/${t.ref}/apps`]) {
      expect((await get(path, jwt)).status, path).toBe(403)
    }
    for (const path of ['/api/v1/notifications', `/api/v1/tickets/${t.ref}/participants`]) {
      expect((await get(path, jwt)).status, path).toBe(401)
    }
    expect((await postJson('/api/v1/ticket-types', { name: 'X' }, bearer(jwt))).status).toBe(403)
    expect((await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'X', description: 'Y' }, bearer(jwt))).status).toBe(403)
    expect((await postJson(`/api/v1/tickets/${t.ref}/apps/1/token`, {}, bearer(jwt))).status).toBe(403)
    expect((await call(`/api/v1/tickets/${t.ref}/attachments`, { method: 'PUT', body: 'x', headers: { ...bearer(jwt), 'content-type': 'text/plain' } })).status).toBe(403)
  })
})

describe('Ticket App writes: when the token stops', () => {
  it('answers 401 after expiry, after the app is turned off or deleted, and after the Agent is deactivated or a Requester', async () => {
    const t = await raise()
    const app = await newApp('comment')
    const ticket = await getTicket(db, { kind: 'user', userId: agent.user.id, role: 'agent', channel: 'web' }, t.number)
    const expired = await contextToken(db, { kind: 'user', userId: agent.user.id, role: 'agent', channel: 'web' }, app.id, ticket, Date.now() - 6 * 60_000)
    expect((await get(`/api/v1/tickets/${t.ref}`, expired.token)).status).toBe(401)

    const off = await tokenFor(agent, t, app)
    await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }), headers: h(admin) })
    expect((await get(`/api/v1/tickets/${t.ref}`, off)).status).toBe(401)

    const gone = await newApp('comment')
    const deleted = await tokenFor(agent, t, gone)
    await call(`/api/v1/admin/ticket-apps/${gone.id}`, { method: 'DELETE', headers: h(admin) })
    expect((await get(`/api/v1/tickets/${t.ref}`, deleted)).status).toBe(401)

    const live = await newApp('comment')
    const [leaver, demoted] = await Promise.all([signInAs('agent'), signInAs('agent')])
    const [a, b] = [await tokenFor(leaver, t, live), await tokenFor(demoted, t, live)]
    expect((await get(`/api/v1/tickets/${t.ref}`, a)).status).toBe(200)
    await env.DB.prepare('UPDATE user SET deactivated_at = ? WHERE id = ?').bind(Date.now(), leaver.user.id).run()
    await env.DB.prepare('UPDATE user SET role = \'requester\' WHERE id = ?').bind(demoted.user.id).run()
    expect((await get(`/api/v1/tickets/${t.ref}`, a)).status).toBe(401)
    expect((await comment(t, b)).status).toBe(401)
  })

  it('answers 401 when the app is no longer shown on the ticket type', async () => {
    const t = await raise()
    const app = await newApp('comment')
    const jwt = await tokenFor(agent, t, app)
    const bug = await typeId(admin.cookie, 'BUG')
    await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'PATCH', body: JSON.stringify({ ticket_type_ids: [bug] }), headers: h(admin) })
    expect((await get(`/api/v1/tickets/${t.ref}`, jwt)).status).toBe(401)
  })

  it('answers 404 after the Agent loses read access to the ticket', async () => {
    const app = await newApp('comment')
    const [owner, participant] = await Promise.all([signInAs('agent'), signInAs('agent')])
    const t = await raise(owner, await createRestrictedType())
    expect((await postJson(`/api/v1/tickets/${t.ref}/participants`, { user_id: participant.user.id }, h(owner))).status).toBe(201)
    const jwt = await tokenFor(participant, t, app)
    expect((await get(`/api/v1/tickets/${t.ref}`, jwt)).status).toBe(200)
    expect((await call(`/api/v1/tickets/${t.ref}/participants/${participant.user.id}`, { method: 'DELETE', headers: h(owner) })).status).toBe(200)
    expect((await get(`/api/v1/tickets/${t.ref}`, jwt)).status).toBe(404)
    expect((await comment(t, jwt)).status).toBe(404)
  })

  it('refuses a token with a changed payload, a wrong audience or an unknown app', async () => {
    const t = await raise()
    const jwt = await tokenFor(agent, t, await newApp('update'))
    const [head, body, sig] = jwt.split('.')
    const claims = JSON.parse(atob(body!.replace(/-/g, '+').replace(/_/g, '/')))
    const forged = btoa(JSON.stringify({ ...claims, tikki_ticket: 'GEN-1' })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect((await get('/api/v1/tickets/GEN-1', `${head}.${forged}.${sig}`)).status).toBe(401)
  })
})

describe('Ticket App writes: token confusion', () => {
  it('a context token gets 401 at /mcp, and an MCP token gets 401 at the REST API', async () => {
    const t = await raise()
    const jwt = await tokenFor(agent, t, await newApp('update'))
    const list = { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), headers: { 'accept': 'application/json, text/event-stream', 'authorization': `Bearer ${jwt}` } }
    expect((await call('/mcp', list)).status).toBe(401)
    expect((await call('/api/auth/oauth2/userinfo', { headers: bearer(jwt) })).status).toBe(401)

    const mcp = await getMcpToken(agent.cookie)
    expect((await get(`/api/v1/tickets/${t.ref}`, mcp.access_token)).status).toBe(401)
    expect((await comment(t, mcp.access_token)).status).toBe(401)
  })
})

describe('Ticket App writes: what is recorded', () => {
  it('a write has an audit entry with channel app, the Agent and the app, an Event and notices', async () => {
    const t = await raise()
    const app = await newApp('update')
    const jwt = await tokenFor(agent, t, app)
    expect((await patch(t, jwt, { status: 'resolved' })).status).toBe(200)
    const added = await (await comment(t, jwt, { body: 'Refund issued.', visibility: 'public' })).json() as { id: string }

    const entries = await env.DB.prepare('SELECT action, channel, principal_id, application_id, ticket_app_id FROM audit_log WHERE ticket_number = ? AND action IN (\'status_changed\', \'comment_added\') ORDER BY id').bind(t.number).all()
    expect(entries.results).toEqual([
      { action: 'status_changed', channel: 'app', principal_id: agent.user.id, application_id: null, ticket_app_id: app.id },
      { action: 'comment_added', channel: 'app', principal_id: agent.user.id, application_id: null, ticket_app_id: app.id },
    ])
    expect(await env.DB.prepare('SELECT channel, ticket_app_id FROM comment WHERE id = ?').bind(added.id).first()).toEqual({ channel: 'app', ticket_app_id: app.id })

    const events = await env.DB.prepare('SELECT type, payload FROM outbox_event WHERE ticket_number = ? AND type IN (\'ticket.updated\', \'comment.created\') ORDER BY created_at').bind(t.number).all<{ type: string, payload: string }>()
    expect(events.results.map(e => e.type)).toEqual(['ticket.updated', 'comment.created'])
    for (const e of events.results) {
      expect(JSON.parse(e.payload).actor).toEqual({ kind: 'user', id: agent.user.id, name: agent.user.name, channel: 'app', ticket_app: { id: app.id, name: app.name } })
    }
    const notices = await env.DB.prepare('SELECT kind, actor_id FROM notification WHERE ticket_number = ? AND user_id = ? ORDER BY id').bind(t.number, requester.user.id).all()
    expect(notices.results).toEqual([{ kind: 'status_changed', actor_id: agent.user.id }, { kind: 'public_comment', actor_id: agent.user.id }])

    // Activity and comments name the app; after the app is deleted, only "a Ticket App".
    const activity = async () => (await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: h(admin) })).json() as { data: Record<string, any>[] }).data
    const status = (await activity()).find(i => i.action === 'status_changed')!
    expect(status).toMatchObject({ channel: 'app', ticket_app: { id: app.id, name: app.name }, principal: { kind: 'user', id: agent.user.id } })
    expect((await activity()).find(i => i.type === 'comment')!.comment).toMatchObject({ channel: 'app', ticket_app: { id: app.id, name: app.name } })
    await call(`/api/v1/admin/ticket-apps/${app.id}`, { method: 'DELETE', headers: h(admin) })
    expect((await activity()).find(i => i.action === 'status_changed')).toMatchObject({ channel: 'app', ticket_app: null })

    // A Requester sees the Agent and the app name: the app is not hidden from people of the organization.
    const own = (await (await call(`/api/v1/tickets/${t.ref}/comments`, { headers: h(requester) })).json() as { data: Record<string, any>[] }).data
    expect(own.find(c => c.id === added.id)).toMatchObject({ channel: 'app', author: { kind: 'user', id: agent.user.id } })
  })

  it('counts the calls in the Agent\'s own web limit', async () => {
    const t = await raise()
    const jwt = await tokenFor(agent, t, await newApp('read'))
    const count = async () => (await env.DB.prepare('SELECT coalesce(sum(count), 0) AS n FROM rate_counter WHERE key = ?').bind(`user:${agent.user.id}`).first<{ n: number }>())!.n
    const before = await count()
    await get(`/api/v1/tickets/${t.ref}`, jwt)
    expect(await count()).toBe(before + 1)
  })

  it('an Application webhook gets the change without the Agent or the app name', async () => {
    const app = await newApp('comment', { name: `Refunds ${counter++}` })
    const created = await (await postJson('/api/v1/applications', { name: `Shop ${counter++}`, description: '', permissions: ['tickets:create', 'tickets:read', 'comments:create'], ticket_type_ids: [gen] }, h(admin))).json() as { id: number }
    const { key } = await (await postJson(`/api/v1/applications/${created.id}/keys`, { name: 'Test' }, h(admin))).json() as { key: string }
    const hook = await (await postJson(`/api/v1/applications/${created.id}/webhook`, { url: `https://hooks.test-receiver.com/${crypto.randomUUID()}` }, h(admin))).json() as { id: string }
    const t = await (await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'Card declined', contact: { external_id: 'cus_35', name: 'Ana Lima', email: 'ana@shop.example' } }, bearer(key))).json() as Ticket

    const jwt = await tokenFor(agent, t, app)
    expect((await comment(t, jwt, { body: 'We refunded you.', visibility: 'public' })).status).toBe(201)
    const delivery = await env.DB.prepare(`SELECT d.payload FROM webhook_delivery d JOIN outbox_event e ON e.id = d.event_id
      WHERE d.endpoint_id = ? AND e.type = 'comment.created'`).bind(hook.id).first<{ payload: string }>()
    const payload = JSON.parse(delivery!.payload)
    expect(payload.actor).toEqual({ kind: 'support' })
    expect(payload.comment.author).toEqual({ kind: 'support' })
    expect(delivery!.payload).not.toContain(app.name)
    expect(delivery!.payload).not.toContain(agent.user.email)

    // The Application's REST view hides the app too.
    const comments = (await (await call(`/api/v1/tickets/${t.ref}/comments`, { headers: bearer(key) })).json() as { data: Record<string, any>[] }).data
    expect(comments.at(-1)).toMatchObject({ channel: 'app', ticket_app: null, author: { kind: 'support' } })
    const activity = (await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: bearer(key) })).json() as { data: Record<string, any>[] }).data
    expect(activity.find(i => i.type === 'comment' && i.comment.channel === 'app')!.comment).toMatchObject({ ticket_app: null, author: { kind: 'support' } })
  })
})

describe('Ticket App writes: the policy without the route allow-list', () => {
  // The allow-list in restPrincipal refuses first, so these rules are checked here directly.
  const admin: UserPrincipal = { kind: 'user', userId: 'u1', role: 'admin', channel: 'app', ticketApp: { id: 1, ticketNumber: 7, access: 'update' } }
  const facts = (number: number): PolicyTicket => ({ number, requesterId: 'u2', applicationId: null, assigneeId: null, visibility: 'requester', participantIds: [], statusKey: 'open', statusCategory: 'open', deleted: false })

  it('limits a token to its ticket and its access, and refuses lists, people, admin, create, types and files', () => {
    expect(authorize(admin, 'read', facts(7))).toBeNull()
    expect(authorize(admin, 'change_status', facts(7))).toBeNull()
    expect(authorize(admin, 'read', facts(8))?.code).toBe('NOT_FOUND')
    for (const action of ['move_team', 'change_type', 'edit_description', 'delete', 'manage_participants', 'cancel', 'reopen'] as const) {
      expect(authorize(admin, action, facts(7))?.status, action).toBe(403)
    }
    const reader: UserPrincipal = { ...admin, ticketApp: { ...admin.ticketApp, access: 'read' } }
    expect(authorize(reader, 'comment', facts(7))?.status).toBe(403)

    expect(isAdmin(admin)).toBe(false)
    expect(authorizeList(admin)?.status).toBe(403)
    expect(authorizeListAssignees(admin)?.status).toBe(403)
    expect(authorizeTicketApps(admin)?.status).toBe(403)
    expect(() => assertMayCreate(admin)).toThrow()
    expect(canSeeTicketType(admin, 1)).toBe(false)
    expect(authorizeAttach(admin, facts(7))?.status).toBe(403)
    expect(authorizeAttach(admin, facts(8))?.status).toBe(404)
    expect(authorizeUnattachedUpload(admin)?.status).toBe(403)
    expect(authorizeAttachmentRead(admin, { uploaderId: 'u1', ticket: null })?.status).toBe(404)

    const web: UserPrincipal = { kind: 'user', userId: 'u1', role: 'admin', channel: 'web' }
    expect(isAdmin(web)).toBe(true)
    expect(authorizeList(web)).toBeNull()
  })

  it('allows only the five routes of the guide', () => {
    expect(isTicketAppRoute('GET', '/api/v1/tickets/GEN-12')).toBe(true)
    expect(isTicketAppRoute('PATCH', '/api/v1/tickets/12')).toBe(true)
    expect(isTicketAppRoute('POST', '/api/v1/tickets/gen-12/comments')).toBe(true)
    expect(isTicketAppRoute('GET', '/api/v1/tickets/GEN-12/activity')).toBe(true)
    for (const [method, path] of [['GET', '/api/v1/tickets/deleted'], ['GET', '/api/v1/tickets/similar'], ['DELETE', '/api/v1/tickets/GEN-12'],
      ['PUT', '/api/v1/tickets/GEN-12/type'], ['POST', '/api/v1/tickets/GEN-12/activity/3/revert'], ['GET', '/api/v1/tickets/GEN-12/comments/x'], ['', '']]) {
      expect(isTicketAppRoute(method!, path!), `${method} ${path}`).toBe(false)
    }
  })
})
