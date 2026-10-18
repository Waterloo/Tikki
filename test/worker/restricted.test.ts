import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { call, connectMcp, createRestrictedType, getMcpToken, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>
type Result = { isError?: boolean, structuredContent?: any, content: unknown }
interface Ticket { number: number, ref: string, title: string, restricted: boolean, allowed_actions: string[] }
interface Participant { id: string, by_rule: string | null, added: boolean }

const h = (s: Session) => ({ cookie: s.cookie })
const get = (s: Session, path: string) => call(path, { headers: h(s) })
const patch = (s: Session, ref: string, body: unknown) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: h(s) })
const addParticipant = (s: Session, ref: string, userId: string) => postJson(`/api/v1/tickets/${ref}/participants`, { user_id: userId }, h(s))
const removeParticipant = (s: Session, ref: string, userId: string) => call(`/api/v1/tickets/${ref}/participants/${userId}`, { method: 'DELETE', headers: h(s) })

let restricted: number
let counter = 0

beforeAll(async () => {
  restricted = await createRestrictedType()
})

/** A Restricted ticket with a title no other ticket has, so a leak shows as that title in a response body. */
async function raise(s: Session) {
  const title = `Data export ZQX${Date.now()}${counter++} customer`
  const res = await postJson('/api/v1/tickets', { ticket_type_id: restricted, title, description: 'Please export all records.' }, h(s))
  expect(res.status, await res.clone().text()).toBe(201)
  const t = await res.json() as Ticket
  expect(t.restricted).toBe(true)
  return t
}

async function attach(s: Session, ref: string) {
  const res = await call(`/api/v1/tickets/${ref}/attachments`, { method: 'PUT', body: new TextEncoder().encode('records'), headers: { ...h(s), 'x-filename': 'export.txt', 'content-type': 'text/plain' } })
  expect(res.status).toBe(201)
  return (await res.json() as { id: string }).id
}

async function canRead(s: Session, ref: string) {
  return (await get(s, `/api/v1/tickets/${ref}`)).status === 200
}

async function auditOf(number: number, action: string) {
  const { results } = await env.DB.prepare('SELECT principal_id, before, after FROM audit_log WHERE ticket_number = ? AND action = ? ORDER BY id').bind(number, action).all<{ principal_id: string, before: string, after: string }>()
  return results.map(r => ({ by: r.principal_id, before: JSON.parse(r.before), after: JSON.parse(r.after) }))
}

async function recipients(number: number, kind: string) {
  const { results } = await env.DB.prepare('SELECT user_id FROM notification WHERE ticket_number = ? AND kind = ?').bind(number, kind).all<{ user_id: string }>()
  return results.map(r => r.user_id).sort()
}
const ids = (...s: Session[]) => s.map(x => x.user.id).sort()

describe('Restricted tickets: the read rule', () => {
  it('answers NOT_FOUND to an Agent who is not a Participant, on every REST route, and leaves it out of counts', async () => {
    const [owner, outsider, admin] = await Promise.all([signInAs('agent'), signInAs('agent'), signInAs('admin')])
    const countsBefore = (await (await get(outsider, '/api/v1/tickets')).json() as { counts: Record<string, number> }).counts
    const t = await raise(owner)
    const fileId = await attach(owner, t.ref)
    expect((await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Exporting now', visibility: 'public' }, h(owner))).status).toBe(201)
    const word = t.title.split(' ')[2]!

    const missing = await get(outsider, '/api/v1/tickets/NOPE-999999')
    const missingBody = await missing.json()
    for (const path of [`/api/v1/tickets/${t.ref}`, `/api/v1/tickets/${t.number}`, `/api/v1/tickets/${t.ref}/comments`, `/api/v1/tickets/${t.ref}/activity`, `/api/v1/tickets/${t.ref}/attachments`, `/api/v1/tickets/${t.ref}/participants`, `/api/v1/attachments/${fileId}`]) {
      const res = await get(outsider, path)
      expect(res.status, path).toBe(404)
      const text = await res.text()
      expect(text, path).not.toContain(t.title)
      if (!path.startsWith('/api/v1/attachments')) expect(JSON.parse(text), path).toEqual(missingBody)
    }
    // Writes are refused the same way.
    expect((await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Hi' }, h(outsider))).status).toBe(404)
    expect((await patch(outsider, t.ref, { assignee_id: outsider.user.id })).status).toBe(404)
    expect((await addParticipant(outsider, t.ref, outsider.user.id)).status).toBe(404)

    for (const path of ['/api/v1/tickets', `/api/v1/tickets?q=${word}`, `/api/v1/tickets?q=${t.ref}`, `/api/v1/tickets?ticket_type_id=${restricted}`, `/api/v1/tickets/similar?title=${encodeURIComponent(t.title)}`]) {
      const res = await get(outsider, path)
      expect(res.status, path).toBe(200)
      expect(await res.text(), path).not.toContain(t.title)
    }
    const countsAfter = (await (await get(outsider, '/api/v1/tickets')).json() as { counts: Record<string, number> }).counts
    expect(countsAfter).toEqual(countsBefore)

    // The owner and an Admin see it in the same lists.
    for (const s of [owner, admin]) {
      expect(await (await get(s, `/api/v1/tickets?q=${word}`)).text()).toContain(t.title)
      expect(await (await get(s, `/api/v1/tickets/similar?title=${encodeURIComponent(t.title)}`)).text()).toContain(t.title)
      expect((await get(s, `/api/v1/attachments/${fileId}`)).status).toBe(200)
    }
    expect((await (await get(admin, '/api/v1/tickets')).json() as { counts: Record<string, number> }).counts.open).toBeGreaterThan(0)
  })

  it('lets the Requester, the assignee, an added Participant and an Admin read it; a removed Participant cannot', async () => {
    const [requester, assignee, added, admin, other] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent'), signInAs('admin'), signInAs('agent')])
    const t = await raise(requester)
    expect(await canRead(requester, t.ref)).toBe(true)
    expect(await canRead(assignee, t.ref)).toBe(false)
    expect(await canRead(admin, t.ref)).toBe(true)

    // Assigning makes a Participant by rule.
    expect((await patch(admin, t.ref, { assignee_id: assignee.user.id })).status).toBe(200)
    expect(await canRead(assignee, t.ref)).toBe(true)

    expect((await addParticipant(requester, t.ref, added.user.id)).status).toBe(201)
    expect(await canRead(added, t.ref)).toBe(true)
    expect((await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'I can help', visibility: 'public' }, h(added))).status).toBe(201)
    expect(await canRead(other, t.ref)).toBe(false)

    expect((await removeParticipant(requester, t.ref, added.user.id)).status).toBe(200)
    expect(await canRead(added, t.ref)).toBe(false)

    // Unassigning removes the right by rule, unless the User was added too.
    expect((await addParticipant(admin, t.ref, assignee.user.id)).status).toBe(201)
    expect((await patch(admin, t.ref, { assignee_id: null })).status).toBe(200)
    expect(await canRead(assignee, t.ref)).toBe(true)
    expect((await removeParticipant(admin, t.ref, assignee.user.id)).status).toBe(200)
    expect(await canRead(assignee, t.ref)).toBe(false)
  })

  it('hides the notices of a removed Participant, and the unread count leaves them out', async () => {
    const [requester, added] = await Promise.all([signInAs('agent'), signInAs('agent')])
    const t = await raise(requester)
    await addParticipant(requester, t.ref, added.user.id)
    await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Look at this', visibility: 'public' }, h(requester))
    const inbox = async () => await (await get(added, '/api/v1/notifications')).json() as { data: { href: string }[], unread_count: number }
    const before = await inbox()
    expect(before.data.some(n => n.href === `/tickets/${t.ref}`)).toBe(true)
    await removeParticipant(requester, t.ref, added.user.id)
    const after = await inbox()
    expect(JSON.stringify(after)).not.toContain(t.ref)
    expect(after.unread_count).toBe(before.unread_count - 1)
  })
})

describe('Restricted tickets: managing Participants', () => {
  it('only the Requester, the assignee and Admins add or remove; each change writes an audit entry and shows in Activity', async () => {
    const [requester, assignee, added, admin, third] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent'), signInAs('admin'), signInAs('requester')])
    const t = await raise(requester)
    await patch(admin, t.ref, { assignee_id: assignee.user.id })

    const res = await addParticipant(requester, t.ref, added.user.id)
    expect(res.status).toBe(201)
    expect((await res.json() as { data: Participant[] }).data).toEqual([
      expect.objectContaining({ id: requester.user.id, by_rule: 'requester', added: false }),
      expect.objectContaining({ id: assignee.user.id, by_rule: 'assignee', added: false }),
      expect.objectContaining({ id: added.user.id, by_rule: null, added: true }),
    ])
    // An added Participant reads, but does not decide who else sees it.
    const refused = await addParticipant(added, t.ref, third.user.id)
    expect(refused.status).toBe(403)
    expect((await refused.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    expect((await removeParticipant(added, t.ref, added.user.id)).status).toBe(403)
    expect((await get(added, `/api/v1/tickets/${t.ref}`).then(r => r.json()) as Ticket).allowed_actions).not.toContain('manage_participants')

    expect((await addParticipant(assignee, t.ref, third.user.id)).status).toBe(201)
    expect((await removeParticipant(admin, t.ref, third.user.id)).status).toBe(200)
    expect((await removeParticipant(assignee, t.ref, added.user.id)).status).toBe(200)

    expect(await auditOf(t.number, 'participant_added')).toEqual([
      { by: requester.user.id, before: null, after: added.user.id },
      { by: assignee.user.id, before: null, after: third.user.id },
    ])
    expect(await auditOf(t.number, 'participant_removed')).toEqual([
      { by: admin.user.id, before: third.user.id, after: null },
      { by: assignee.user.id, before: added.user.id, after: null },
    ])
    // Activity names the User (a new User has no name yet, so the email).
    const activity = (await (await get(requester, `/api/v1/tickets/${t.ref}/activity`)).json() as { data: { action?: string, before: string | null, after: string | null }[] }).data
    expect(activity.filter(a => a.action?.startsWith('participant_')).map(a => [a.action, a.after ?? a.before])).toEqual([
      ['participant_added', added.user.email],
      ['participant_added', third.user.email],
      ['participant_removed', third.user.email],
      ['participant_removed', added.user.email],
    ])
  })

  it('refuses a deactivated User, the Requester, a repeat, an unknown User, and a ticket that is not Restricted', async () => {
    const [requester, agent, gone] = await Promise.all([signInAs('agent'), signInAs('agent'), signInAs('agent')])
    const t = await raise(requester)
    await env.DB.prepare('UPDATE user SET deactivated_at = ? WHERE id = ?').bind(Date.now(), gone.user.id).run()
    for (const id of [gone.user.id, requester.user.id, 'no-such-user']) expect((await addParticipant(requester, t.ref, id)).status, id).toBe(422)
    expect((await addParticipant(requester, t.ref, agent.user.id)).status).toBe(201)
    expect((await addParticipant(requester, t.ref, agent.user.id)).status).toBe(422)
    expect(await auditOf(t.number, 'participant_added')).toHaveLength(1)
    expect((await removeParticipant(requester, t.ref, requester.user.id)).status).toBe(404)

    const plain = await (await postJson('/api/v1/tickets', { ticket_type_id: await typeId(requester.cookie, 'GEN'), title: 'Printer' }, h(requester))).json() as Ticket
    expect(plain.restricted).toBe(false)
    expect((await addParticipant(requester, plain.ref, agent.user.id)).status).toBe(403)

    // The add picker: active Users who are not added yet.
    const found = (await (await get(requester, `/api/v1/tickets/${t.ref}/participants/candidates?q=${encodeURIComponent(gone.user.email)}`)).json() as { data: { id: string }[] }).data
    expect(found).toEqual([])
    const again = (await (await get(requester, `/api/v1/tickets/${t.ref}/participants/candidates?q=${encodeURIComponent(agent.user.email)}`)).json() as { data: { id: string }[] }).data
    expect(again).toEqual([])
  })

  it('an Agent who would lose the ticket cannot move it into a Participants only type', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await (await postJson('/api/v1/tickets', { ticket_type_id: await typeId(requester.cookie, 'GEN'), title: 'Move me' }, h(requester))).json() as Ticket
    const move = () => call(`/api/v1/tickets/${t.ref}/type`, { method: 'PUT', body: JSON.stringify({ ticket_type_id: restricted }), headers: h(agent) })
    expect((await move()).status).toBe(422)
    await patch(agent, t.ref, { assignee_id: agent.user.id })
    const moved = await move()
    expect(moved.status).toBe(200)
    expect((await moved.json() as Ticket).restricted).toBe(true)
  })
})

describe('Restricted tickets: MCP', () => {
  it('get_ticket, search_tickets and list_my_tickets follow the same rule', async () => {
    const [owner, outsider] = await Promise.all([signInAs('agent'), signInAs('agent')])
    const t = await raise(owner)
    const word = t.title.split(' ')[2]!

    const out = await connectMcp((await getMcpToken(outsider.cookie)).access_token)
    const got = await out.callTool({ name: 'get_ticket', arguments: { ticket: t.ref } }) as Result
    expect(got.isError).toBe(true)
    expect(JSON.stringify(got)).toContain('NOT_FOUND')
    expect(JSON.stringify(got)).not.toContain(t.title)
    const searched = await out.callTool({ name: 'search_tickets', arguments: { query: word } }) as Result
    expect(searched.isError).toBeFalsy()
    expect(JSON.stringify(searched)).not.toContain(t.title)
    expect(JSON.stringify(await out.callTool({ name: 'list_my_tickets', arguments: {} }))).not.toContain(t.title)
    await out.close()

    const own = await connectMcp((await getMcpToken(owner.cookie)).access_token)
    expect(JSON.stringify(await own.callTool({ name: 'get_ticket', arguments: { ticket: t.ref } }))).toContain(word)
    expect(JSON.stringify(await own.callTool({ name: 'search_tickets', arguments: { query: word } }))).toContain(word)
    expect(JSON.stringify(await own.callTool({ name: 'list_my_tickets', arguments: {} }))).toContain(word)
    await own.close()
  })
})

describe('Restricted tickets: notices', () => {
  it('"ticket created" goes to no Team member, and comment notices go to Participants only', async () => {
    const [requester, assignee, addedAgent, addedRequester, outsider, admin] = await Promise.all([
      signInAs('requester'), signInAs('agent'), signInAs('agent'), signInAs('requester'), signInAs('agent'), signInAs('admin'),
    ])
    const t = await raise(requester)
    // The Requester is the actor, and nobody else is a Participant yet.
    expect(await recipients(t.number, 'ticket_created')).toEqual([])

    await patch(admin, t.ref, { assignee_id: assignee.user.id })
    await addParticipant(requester, t.ref, addedAgent.user.id)
    await addParticipant(requester, t.ref, addedRequester.user.id)

    await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Any news?', visibility: 'public' }, h(requester))
    expect(await recipients(t.number, 'public_comment')).toEqual(ids(assignee, addedAgent, addedRequester))

    await postJson(`/api/v1/tickets/${t.ref}/comments`, { body: 'Check the old system', visibility: 'internal' }, h(assignee))
    // A Requester cannot read Internal Comments, also as an added Participant.
    expect(await recipients(t.number, 'internal_comment')).toEqual(ids(addedAgent))
    expect(await recipients(t.number, 'public_comment')).not.toContain(outsider.user.id)
    expect(await recipients(t.number, 'public_comment')).not.toContain(admin.user.id)
  })
})

describe('Restricted tickets: Applications', () => {
  it('cannot have a Restricted type in its allowed list, and cannot create a ticket of one', async () => {
    const admin = await signInAs('admin')
    const gen = await typeId(admin.cookie, 'GEN')
    const refused = await postJson('/api/v1/applications', { name: `Shop ${Date.now()}`, permissions: ['tickets:create', 'tickets:read'], ticket_type_ids: [restricted] }, h(admin))
    expect(refused.status).toBe(422)
    expect(JSON.stringify(await refused.json())).toContain('Participants only')

    const res = await postJson('/api/v1/applications', { name: `Shop ${Date.now()} b`, permissions: ['tickets:create', 'tickets:read'], ticket_type_ids: [gen] }, h(admin))
    expect(res.status).toBe(201)
    const app = await res.json() as { id: number }
    const patchApp = await call(`/api/v1/applications/${app.id}`, { method: 'PATCH', body: JSON.stringify({ ticket_type_ids: [gen, restricted] }), headers: h(admin) })
    expect(patchApp.status).toBe(422)

    // A type that an Application uses cannot become Participants only.
    const typePatch = await call(`/api/v1/ticket-types/${gen}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'participants' }), headers: h(admin) })
    expect(typePatch.status).toBe(422)
    expect(JSON.stringify(await typePatch.json())).toContain('visibility')

    // Even with the type forced into the list, the create is refused.
    await env.DB.prepare('UPDATE application SET ticket_type_ids = ? WHERE id = ?').bind(JSON.stringify([gen, restricted]), app.id).run()
    const key = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'Prod' }, h(admin))).json() as { key: string }
    const create = await postJson('/api/v1/tickets', { ticket_type_id: restricted, title: 'Export my data', contact: { external_id: 'c1', name: 'Ana', email: 'ana@shop.example' } }, { authorization: `Bearer ${key.key}` })
    expect(create.status).toBe(403)
    expect((await create.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
  })
})
