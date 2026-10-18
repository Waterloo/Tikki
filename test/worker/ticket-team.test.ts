import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, connectMcp, createRestrictedType, getMcpToken, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>
interface Ticket { number: number, ref: string, team?: { id: number, name: string }, assignee: { id: string } | null, allowed_actions: string[], ticket_type: { id: number } }
interface ErrorBody { error: { code: string, message: string, details: { key: string, reason: string }[] | null } }
type Result = { isError?: boolean, structuredContent?: any }

const h = (s: Session) => ({ cookie: s.cookie })
const patch = (s: Session, ref: string, body: unknown) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: h(s) })
const read = async (s: Session, ref: string) => await (await call(`/api/v1/tickets/${ref}`, { headers: h(s) })).json() as Ticket

async function create(s: Session, prefix = 'GEN', typeIdOverride?: number) {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: typeIdOverride ?? await typeId(s.cookie, prefix), title: 'Needs routing' }, h(s))
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Ticket
}

let teamCounter = 0
async function newTeam(members: Session[] = []) {
  const row = await env.DB.prepare('INSERT INTO team (name, created_at) VALUES (?, ?) RETURNING id, name').bind(`Team ${Date.now()} ${teamCounter++}`, Date.now()).first<{ id: number, name: string }>()
  for (const m of members) await env.DB.prepare('INSERT INTO team_member (team_id, user_id, created_at) VALUES (?, ?, ?)').bind(row!.id, m.user.id, Date.now()).run()
  return row!
}

const supportId = async () => (await env.DB.prepare("SELECT id FROM team WHERE name = 'Support'").first<{ id: number }>())!.id

async function recipients(number: number, kind: string) {
  const { results } = await env.DB.prepare('SELECT user_id FROM notification WHERE ticket_number = ? AND kind = ? ORDER BY user_id').bind(number, kind).all<{ user_id: string }>()
  return results.map(r => r.user_id).sort()
}
const ids = (...s: Session[]) => s.map(x => x.user.id).sort()

describe('assign to any Agent', () => {
  it('assigns to another active Agent or Admin; refuses a Requester, a deactivated User and an unknown ID', async () => {
    const [requester, agent, other, admin, gone, plain] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent'), signInAs('admin'), signInAs('agent'), signInAs('requester')])
    await env.DB.prepare('UPDATE user SET deactivated_at = ? WHERE id = ?').bind(Date.now(), gone.user.id).run()
    const t = await create(requester)

    const ok = await patch(agent, t.ref, { assignee_id: other.user.id })
    expect(ok.status).toBe(200)
    expect((await ok.json() as Ticket).assignee?.id).toBe(other.user.id)
    expect((await patch(agent, t.ref, { assignee_id: admin.user.id })).status).toBe(200)

    for (const id of [plain.user.id, gone.user.id, 'no-such-user']) {
      const res = await patch(agent, t.ref, { assignee_id: id })
      expect(res.status, id).toBe(422)
      expect((await res.json() as ErrorBody).error.details![0]).toMatchObject({ key: 'assignee_id', reason: 'Must be the ID of an active Agent or Admin.' })
    }
    expect((await read(agent, t.ref)).assignee?.id).toBe(admin.user.id)
  })

  it('lists only active staff for the picker, with Team IDs, and shows it to staff only', async () => {
    const [requester, agent, gone] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    await env.DB.prepare('UPDATE user SET deactivated_at = ? WHERE id = ?').bind(Date.now(), gone.user.id).run()
    const team = await newTeam([agent])
    const res = await call('/api/v1/assignees', { headers: h(agent) })
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { id: string, email: string, role: string, team_ids: number[] }[], teams: { id: number }[] }
    expect(body.data.find(p => p.id === agent.user.id)?.team_ids).toEqual([team.id])
    expect(body.data.map(p => p.id)).not.toContain(requester.user.id)
    expect(body.data.map(p => p.id)).not.toContain(gone.user.id)
    expect(body.data.every(p => p.role === 'agent' || p.role === 'admin')).toBe(true)
    expect(body.teams.map(t => t.id)).toContain(team.id)
    expect((await call('/api/v1/assignees', { headers: h(requester) })).status).toBe(403)
    expect((await call('/api/v1/assignees')).status).toBe(401)
  })
})

describe('a ticket has its own Team', () => {
  it('starts with the Team of its type, and a move changes the ticket, not the type', async () => {
    const [requester, agent, other] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    const dev = await newTeam()
    const t = await create(requester)
    expect(t.team?.id).toBe(await supportId())
    await patch(agent, t.ref, { assignee_id: other.user.id })

    const moved = await patch(agent, t.ref, { team_id: dev.id })
    expect(moved.status, await moved.clone().text()).toBe(200)
    const after = await moved.json() as Ticket
    expect(after.team).toEqual({ id: dev.id, name: dev.name })
    // Moving keeps the assignee.
    expect(after.assignee?.id).toBe(other.user.id)
    const type = (await env.DB.prepare('SELECT team_id FROM ticket_type WHERE id = ?').bind(t.ticket_type.id).first<{ team_id: number }>())!
    expect(type.team_id).toBe(await supportId())

    // A new ticket of the same type still starts in the type's Team.
    expect((await create(requester)).team?.id).toBe(await supportId())

    // Same Team again changes nothing: no second audit entry.
    expect((await patch(agent, t.ref, { team_id: dev.id })).status).toBe(200)
    const log = await env.DB.prepare("SELECT before, after, principal_id FROM audit_log WHERE ticket_number = ? AND action = 'team_changed'").bind(t.number).all<{ before: string, after: string, principal_id: string }>()
    expect(log.results).toHaveLength(1)
    expect(JSON.parse(log.results[0]!.before)).toEqual({ id: await supportId(), name: 'Support' })
    expect(JSON.parse(log.results[0]!.after)).toEqual({ id: dev.id, name: dev.name })
    expect(log.results[0]!.principal_id).toBe(agent.user.id)

    const activity = await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: h(agent) })).json() as { data: { action?: string, before: string, after: string }[] }
    expect(activity.data.find(i => i.action === 'team_changed')).toMatchObject({ before: 'Support', after: dev.name })
  })

  it('refuses an unknown Team (422), and a Requester (403)', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    const unknown = await patch(agent, t.ref, { team_id: 999999 })
    expect(unknown.status).toBe(422)
    expect((await unknown.json() as ErrorBody).error.details![0]).toMatchObject({ key: 'team_id', reason: 'No Team has this ID.' })
    expect((await patch(agent, t.ref, { team_id: 'x' })).status).toBe(422)
    const refused = await patch(requester, t.ref, { team_id: await supportId() })
    expect(refused.status).toBe(403)
    expect((await read(requester, t.ref)).allowed_actions).not.toContain('move_team')
    expect((await read(agent, t.ref)).allowed_actions).toContain('move_team')
  })

  it('a type change sets the Team of the new type, also after a manual move', async () => {
    const [requester, agent, admin] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const finance = await newTeam()
    const prefix = `T${Date.now().toString(36).slice(-3).toUpperCase().replace(/[^A-Z]/g, 'Q')}`
    const made = await postJson('/api/v1/ticket-types', { name: `Finance ${prefix}`, prefix, description: 'x', visibility: 'internal', team_id: finance.id, fields: [] }, h(admin))
    expect(made.status, await made.clone().text()).toBe(201)
    const type = await made.json() as { id: number }

    const t = await create(requester)
    const dev = await newTeam()
    await patch(agent, t.ref, { team_id: dev.id })
    const res = await call(`/api/v1/tickets/${t.ref}/type`, { method: 'PUT', body: JSON.stringify({ ticket_type_id: type.id }), headers: h(agent) })
    expect(res.status, await res.clone().text()).toBe(200)
    expect((await res.json() as Ticket).team).toEqual({ id: finance.id, name: finance.name })
    const entries = await env.DB.prepare('SELECT action FROM audit_log WHERE ticket_number = ? ORDER BY id').bind(t.number).all<{ action: string }>()
    expect(entries.results.map(r => r.action)).toEqual(['ticket_created', 'team_changed', 'type_changed', 'team_changed'])
  })

  it('the list filter uses the ticket\'s Team, not the type\'s', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const dev = await newTeam()
    const [moved, stays] = [await create(requester), await create(requester)]
    await patch(agent, moved.ref, { team_id: dev.id })
    const listed = async (team: number) => ((await (await call(`/api/v1/tickets?team=${team}&limit=200`, { headers: h(agent) })).json()) as { data: (Ticket & { team: { id: number } })[] }).data

    expect((await listed(dev.id)).map(t => t.number)).toEqual([moved.number])
    const inSupport = (await listed(await supportId())).map(t => t.number)
    expect(inSupport).toContain(stays.number)
    expect(inSupport).not.toContain(moved.number)
    expect((await listed(dev.id))[0]!.team.id).toBe(dev.id)
    expect((await call('/api/v1/tickets?team=abc', { headers: h(agent) })).status).toBe(422)
  })
})

describe('removing a Team', () => {
  it('is refused while a ticket is in it', async () => {
    const [admin, requester] = await Promise.all([signInAs('admin'), signInAs('requester')])
    const dev = await newTeam()
    const t = await create(requester)
    await patch(admin, t.ref, { team_id: dev.id })
    const refused = await call(`/api/v1/teams/${dev.id}`, { method: 'DELETE', headers: h(admin) })
    expect(refused.status).toBe(409)
    expect((await refused.json() as ErrorBody).error.code).toBe('TEAM_HAS_TICKETS')
    await patch(admin, t.ref, { team_id: await supportId() })
    expect((await call(`/api/v1/teams/${dev.id}`, { method: 'DELETE', headers: h(admin) })).status).toBe(204)
  })
})

describe('moved_to_team notice', () => {
  it('goes to the members of the new Team, not to the actor', async () => {
    const [requester, actor, member, outsider] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent'), signInAs('agent')])
    const dev = await newTeam([actor, member])
    const t = await create(requester)
    expect((await patch(actor, t.ref, { team_id: dev.id })).status).toBe(200)
    expect(await recipients(t.number, 'moved_to_team')).toEqual(ids(member))
    expect(await recipients(t.number, 'moved_to_team')).not.toContain(outsider.user.id)

    const inbox = await (await call('/api/v1/notifications', { headers: h(member) })).json() as { data: { kind: string, head: string, href: string }[] }
    expect(inbox.data.find(n => n.kind === 'moved_to_team')).toMatchObject({ head: expect.stringContaining(`moved ${t.ref} to ${dev.name}`), href: `/tickets/${t.ref}` })
  })

  it('goes to the Participants only on a Restricted ticket', async () => {
    const [admin, assignee, other] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('agent')])
    const dev = await newTeam([assignee, other])
    const t = await create(admin, 'GEN', await createRestrictedType())
    expect((await patch(admin, t.ref, { assignee_id: assignee.user.id })).status).toBe(200)
    expect((await patch(admin, t.ref, { team_id: dev.id })).status).toBe(200)
    expect(await recipients(t.number, 'moved_to_team')).toEqual(ids(assignee))
  })
})

describe('Event and Application privacy', () => {
  it('writes a ticket.updated Event with `team` in `changed` and both Teams in before and after', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const dev = await newTeam()
    const t = await create(requester)
    await patch(agent, t.ref, { team_id: dev.id })
    const row = await env.DB.prepare("SELECT payload FROM outbox_event WHERE ticket_number = ? AND type = 'ticket.updated' ORDER BY rowid DESC").bind(t.number).first<{ payload: string }>()
    const payload = JSON.parse(row!.payload) as { changed: string[], before: { team: { name: string } }, after: { team: { id: number, name: string } } }
    expect(payload.changed).toEqual(['team'])
    expect(payload.before.team.name).toBe('Support')
    expect(payload.after.team).toEqual({ id: dev.id, name: dev.name })
  })

  it('an Application sees no Team: not in the ticket, not in its webhook, and a Team-only move sends nothing', async () => {
    const [admin, agent] = await Promise.all([signInAs('admin'), signInAs('agent')])
    const gen = await typeId(admin.cookie, 'GEN')
    const app = await (await postJson('/api/v1/applications', { name: `Shop ${crypto.randomUUID()}`, description: '', permissions: ['tickets:create', 'tickets:read', 'tickets:update', 'comments:create'], ticket_type_ids: [gen] }, h(admin))).json() as { id: number }
    const { key } = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'Test' }, h(admin))).json() as { key: string }
    const auth = { authorization: `Bearer ${key}` }
    const hook = await postJson(`/api/v1/applications/${app.id}/webhook`, { url: 'https://hooks.test-receiver.com/team-test' }, h(admin))
    expect(hook.status, await hook.clone().text()).toBe(201)
    const dev = await newTeam()

    const created = await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'Card declined', contact: { external_id: 'cus_9', name: 'Ana', email: 'ana@shop.example' } }, auth)
    expect(created.status).toBe(201)
    const t = await created.json() as Ticket
    expect('team' in t).toBe(false)
    expect('team' in await (await call(`/api/v1/tickets/${t.ref}`, { headers: auth })).json() as object).toBe(false)
    expect('team' in ((await (await call('/api/v1/tickets', { headers: auth })).json()) as { data: object[] }).data[0]!).toBe(false)

    // An Application cannot move or assign.
    for (const body of [{ team_id: dev.id }, { assignee_id: agent.user.id }]) {
      const res = await patch({ cookie: '' } as Session, t.ref, body)
      expect(res.status).toBe(401)
      const asApp = await call(`/api/v1/tickets/${t.ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: auth })
      expect(asApp.status).toBe(403)
    }

    const deliveries = async () => (await env.DB.prepare("SELECT d.payload FROM webhook_delivery d JOIN outbox_event e ON e.id = d.event_id WHERE e.ticket_number = ? AND e.type = 'ticket.updated'").bind(t.number).all<{ payload: string }>()).results
    expect((await patch(agent, t.ref, { team_id: dev.id })).status).toBe(200)
    expect(await deliveries()).toHaveLength(0)

    expect((await patch(agent, t.ref, { priority: 'high', team_id: await supportId() })).status).toBe(200)
    const sent = await deliveries()
    expect(sent).toHaveLength(1)
    const payload = JSON.parse(sent[0]!.payload) as { changed: string[], before: object, after: object }
    expect(payload.changed).toEqual(['priority'])
    expect('team' in payload.before).toBe(false)
    expect('team' in payload.after).toBe(false)

    // No Team move in the Activity of an Application.
    const activity = await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: auth })).json() as { data: { action?: string }[] }
    expect(activity.data.map(i => i.action)).not.toContain('team_changed')
  })
})

describe('MCP', () => {
  async function connectAs(s: Session) {
    return connectMcp((await getMcpToken(s.cookie)).access_token)
  }

  it('assign_ticket takes me, none, or the email of an active Agent', async () => {
    const [requester, agent, other, plain] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent'), signInAs('requester')])
    const t = await create(requester)
    const client = await connectAs(agent)
    const assign = async (assignee: string) => await client.callTool({ name: 'assign_ticket', arguments: { ticket: t.ref, assignee } }) as Result

    const byEmail = await assign(other.user.email.toUpperCase())
    expect(byEmail.isError).toBeFalsy()
    expect(byEmail.structuredContent.assignee_id).toBe(other.user.id)
    expect((await assign('me')).structuredContent.assignee_id).toBe(agent.user.id)
    expect((await assign('none')).structuredContent.assignee_id).toBeNull()

    // A Requester and an unknown email fail like on REST.
    for (const email of [plain.user.email, 'nobody@example.com']) {
      const refused = await assign(email)
      expect(refused.isError, email).toBe(true)
      expect(refused.structuredContent.problems[0]).toMatchObject({ key: 'assignee_id', reason: 'Must be the ID of an active Agent or Admin.' })
    }
    expect((await read(agent, t.ref)).assignee).toBeNull()
    await client.close()

    // A Requester gets the policy refusal first.
    const rc = await connectAs(requester)
    const forbidden = await rc.callTool({ name: 'assign_ticket', arguments: { ticket: t.ref, assignee: other.user.email } }) as Result
    expect(forbidden.isError).toBe(true)
    expect(forbidden.structuredContent.error.code).toBe('FORBIDDEN')
    await rc.close()
  })

  it('move_ticket_team moves by Team name', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const dev = await newTeam()
    const t = await create(requester)
    const client = await connectAs(agent)
    const moved = await client.callTool({ name: 'move_ticket_team', arguments: { ticket: t.ref, team: dev.name.toUpperCase() } }) as Result
    expect(moved.isError, JSON.stringify(moved)).toBeFalsy()
    expect((await read(agent, t.ref)).team?.id).toBe(dev.id)
    const unknown = await client.callTool({ name: 'move_ticket_team', arguments: { ticket: t.ref, team: 'Nowhere' } }) as Result
    expect(unknown.isError).toBe(true)
    await client.close()

    const rc = await connectAs(requester)
    const refused = await rc.callTool({ name: 'move_ticket_team', arguments: { ticket: t.ref, team: 'Support' } }) as Result
    expect(refused.structuredContent.error.code).toBe('FORBIDDEN')
    await rc.close()
  })
})
