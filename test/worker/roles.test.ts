import { describe, expect, it } from 'vitest'
import { call, connectMcp, createVisibleType, getMcpToken, postJson, signInAs, typeId } from './helpers'

interface Ticket {
  number: number
  ref: string
  status: { key: string, name: string, category: string }
  priority: string
  assignee: { id: string } | null
  requester: { id: string }
  updated_at: string
  allowed_actions: string[]
}

interface ErrorBody { error: { code: string, message: string, details: unknown } }

type Session = Awaited<ReturnType<typeof signInAs>>

async function create(session: Session, ticketTypeId: number, title = 'A ticket') {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: ticketTypeId, title }, { cookie: session.cookie })
  expect(res.status).toBe(201)
  return await res.json() as Ticket
}

function get(session: Session, ref: string) {
  return call(`/api/v1/tickets/${ref}`, { headers: { cookie: session.cookie } })
}

function patch(session: Session, ref: string, body: unknown) {
  return call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: { cookie: session.cookie } })
}

async function list(session: Session, query = '') {
  const res = await call(`/api/v1/tickets${query}`, { headers: { cookie: session.cookie } })
  expect(res.status).toBe(200)
  return await res.json() as { data: Ticket[], counts: Record<string, number> }
}

describe('policy: who can read a ticket', () => {
  it('hides another Requester\'s ticket of a private type, and shows one of a "visible to all" type', async () => {
    const [owner, other, agent] = await Promise.all([signInAs('requester'), signInAs('requester'), signInAs('agent')])
    const gen = await typeId(owner.cookie, 'GEN')
    const shared = await createVisibleType()
    const hidden = await create(owner, gen, 'Private')
    const visible = await create(owner, shared, 'For everyone')

    const refused = await get(other, hidden.ref)
    expect(refused.status).toBe(404)
    expect(await refused.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No ticket with this reference.', details: null } })
    expect((await get(other, visible.ref)).status).toBe(200)

    // The list uses the same rule as the single read.
    const refs = (await list(other)).data.map(t => t.ref)
    expect(refs).toContain(visible.ref)
    expect(refs).not.toContain(hidden.ref)
    expect((await list(other, '?requester=me')).data.map(t => t.ref)).not.toContain(visible.ref)

    // Agents see all tickets (3.5).
    expect((await get(agent, hidden.ref)).status).toBe(200)
    expect((await list(agent)).data.map(t => t.ref)).toEqual(expect.arrayContaining([hidden.ref, visible.ref]))
  })
})

describe('policy: who can change a ticket', () => {
  it('refuses Status, Priority, and assignee changes from a Requester, on their own ticket too', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const ticket = await create(requester, await typeId(requester.cookie, 'GEN'))
    // Own open ticket: edit and cancel are allowed (issue 09). Status, Priority and assignee are not.
    expect(ticket.allowed_actions).toEqual(['edit_fields', 'edit_description', 'comment', 'cancel'])

    for (const [body, message] of [
      [{ status: 'in_progress' }, 'Only Agents can change the Status of a ticket.'],
      [{ assignee_id: agent.user.id }, 'Only Agents can assign a ticket.'],
      [{ assignee_id: requester.user.id }, 'Only Agents can assign a ticket.'],
      [{ priority: 'urgent' }, 'Only Agents can change the Priority of a ticket.'],
      // One refused key refuses the whole request.
      [{ priority: 'urgent', status: 'closed' }, 'Only Agents can change the Status of a ticket.'],
    ] as const) {
      const res = await patch(requester, ticket.ref, body)
      expect(res.status, JSON.stringify(body)).toBe(403)
      expect(await res.json()).toEqual({ error: { code: 'FORBIDDEN', message, details: null } })
    }

    const after = await (await get(requester, ticket.ref)).json() as Ticket
    expect(after).toMatchObject({ status: { key: 'open' }, priority: 'normal', assignee: null, updated_at: ticket.updated_at })
  })

  it('answers NOT_FOUND, not FORBIDDEN, for a ticket the Requester cannot read', async () => {
    const [owner, other] = await Promise.all([signInAs('requester'), signInAs('requester')])
    const ticket = await create(owner, await typeId(owner.cookie, 'GEN'))
    const res = await patch(other, ticket.ref, { status: 'closed' })
    expect(res.status).toBe(404)
    expect((await res.json() as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('lets an Agent change Status, Priority, and assignee, and an Admin too', async () => {
    const [requester, agent, admin] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const ticket = await create(requester, await typeId(requester.cookie, 'GEN'))

    const assigned = await patch(agent, ticket.ref, { assignee_id: agent.user.id })
    expect(assigned.status).toBe(200)
    const a = await assigned.json() as Ticket
    expect(a.assignee?.id).toBe(agent.user.id)
    expect(a.allowed_actions).toEqual(['change_status', 'change_priority', 'assign', 'edit_fields', 'edit_description', 'change_type', 'move_team', 'comment', 'comment_internal'])
    expect(a.updated_at > ticket.updated_at).toBe(true)

    const moved = await (await patch(agent, String(ticket.number), { status: 'in_progress', priority: 'high' })).json() as Ticket
    expect(moved).toMatchObject({ status: { key: 'in_progress', name: 'In progress', category: 'active' }, priority: 'high' })

    const byAdmin = await patch(admin, ticket.ref, { status: 'resolved', assignee_id: null })
    expect(byAdmin.status).toBe(200)
    expect(await byAdmin.json()).toMatchObject({ status: { key: 'resolved', category: 'done' }, assignee: null })

    // The Requester reads the result.
    expect(await (await get(requester, ticket.ref)).json()).toMatchObject({ status: { key: 'resolved' }, priority: 'high', assignee: null })
  })

  it('tells an Agent what to fix in a bad change', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const ticket = await create(requester, await typeId(requester.cookie, 'GEN'))
    const details = async (body: unknown) => {
      const res = await patch(agent, ticket.ref, body)
      expect(res.status, JSON.stringify(body)).toBe(422)
      return (await res.json() as ErrorBody).error.details
    }

    expect(await details({ status: 'done' })).toEqual([
      { key: 'status', label: 'Status', reason: 'Must be one of the options.', options: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
    ])
    expect(await details({ assignee_id: requester.user.id })).toEqual([
      { key: 'assignee_id', label: 'Assignee', reason: 'Must be the ID of an active Agent or Admin.' },
    ])
    expect(await details({ title: 'New title' })).toEqual([
      { key: 'body', label: 'Request body', reason: 'Only status, priority, assignee_id, team_id, fields, description can change here. Unknown: title.' },
    ])
    expect(await details({})).toEqual([
      { key: 'body', label: 'Request body', reason: 'Send at least one of status, priority, assignee_id, team_id, fields, description.' },
    ])
  })
})

describe('policy: REST and MCP give the same refusal', () => {
  it('for a Requester changing Status or assignee, and for a ticket the Requester cannot read', async () => {
    const [requester, other] = await Promise.all([signInAs('requester'), signInAs('requester')])
    const gen = await typeId(requester.cookie, 'GEN')
    const own = await create(requester, gen)
    const notMine = await create(other, gen)
    const client = await connectMcp((await getMcpToken(requester.cookie)).access_token)

    const cases = [
      { tool: 'change_status', args: { ticket: own.ref, status: 'closed' }, ref: own.ref, body: { status: 'closed' } },
      { tool: 'change_priority', args: { ticket: own.ref, priority: 'urgent' }, ref: own.ref, body: { priority: 'urgent' } },
      { tool: 'assign_ticket', args: { ticket: own.ref, assignee: 'me' }, ref: own.ref, body: { assignee_id: requester.user.id } },
      { tool: 'change_status', args: { ticket: notMine.ref, status: 'closed' }, ref: notMine.ref, body: { status: 'closed' } },
    ]
    for (const c of cases) {
      const rest = (await (await patch(requester, c.ref, c.body)).json() as ErrorBody).error
      const mcp = await client.callTool({ name: c.tool, arguments: c.args })
      expect(mcp.isError, c.tool).toBe(true)
      expect(mcp.structuredContent, c.tool).toEqual({ error: { code: rest.code, message: rest.message } })
      expect(JSON.stringify(mcp.content)).toContain(rest.message)
    }
    await client.close()
  })

  it('and an Agent changes a ticket through MCP, as through REST', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const ticket = await create(requester, await typeId(requester.cookie, 'GEN'))
    const client = await connectMcp((await getMcpToken(agent.cookie)).access_token)

    const assigned = await client.callTool({ name: 'assign_ticket', arguments: { ticket: ticket.ref, assignee: 'me' } })
    expect(assigned.isError).toBeFalsy()
    expect(assigned.structuredContent).toMatchObject({ ref: ticket.ref, assignee_id: agent.user.id })
    const moved = await client.callTool({ name: 'change_status', arguments: { ticket: ticket.ref, status: 'waiting' } })
    expect(moved.structuredContent).toMatchObject({ status: 'waiting' })
    const bad = await client.callTool({ name: 'change_status', arguments: { ticket: ticket.ref, status: 'done' } })
    expect(bad.isError).toBe(true)
    expect(JSON.stringify(bad.content)).toContain('in_progress')
    await client.close()

    expect(await (await get(agent, ticket.ref)).json()).toMatchObject({ status: { key: 'waiting' }, assignee: { id: agent.user.id } })
  })
})

describe('the agent queue', () => {
  it('lists the five Statuses in workflow order with their categories', async () => {
    const agent = await signInAs('agent')
    const res = await call('/api/v1/statuses', { headers: { cookie: agent.cookie } })
    expect(await res.json()).toEqual({
      data: [
        { key: 'open', name: 'Open', category: 'open' },
        { key: 'in_progress', name: 'In progress', category: 'active' },
        { key: 'waiting', name: 'Waiting on requester', category: 'waiting' },
        { key: 'resolved', name: 'Resolved', category: 'done' },
        { key: 'closed', name: 'Closed', category: 'done' },
      ],
    })
    expect((await call('/api/v1/statuses')).status).toBe(401)
  })

  it('orders tickets by Status with a count for each, and the three filters return the right tickets', async () => {
    const [requester, me, colleague] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    const gen = await typeId(requester.cookie, 'GEN')
    const unassigned = await create(requester, gen, 'Nobody has it')
    const mine = await create(requester, gen, 'Mine')
    const theirs = await create(requester, gen, 'Theirs')
    await patch(me, mine.ref, { assignee_id: me.user.id, status: 'in_progress' })
    await patch(colleague, theirs.ref, { assignee_id: colleague.user.id, status: 'waiting' })

    const all = await list(me)
    expect(all.data.map(t => t.ref)).toEqual(expect.arrayContaining([unassigned.ref, mine.ref, theirs.ref]))
    const order = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
    const positions = all.data.map(t => order.indexOf(t.status.key))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    for (const key of order) {
      expect(all.counts[key] ?? 0, key).toBe(all.data.filter(t => t.status.key === key).length)
    }

    const none = await list(me, '?assignee=none')
    expect(none.data.every(t => t.assignee === null)).toBe(true)
    expect(none.data.map(t => t.ref)).toContain(unassigned.ref)
    expect(none.data.map(t => t.ref)).not.toContain(mine.ref)

    const assignedToMe = await list(me, '?assignee=me')
    expect(assignedToMe.data.map(t => t.ref)).toEqual([mine.ref])
    expect(assignedToMe.counts).toEqual({ in_progress: 1 })
    expect((await list(colleague, '?assignee=me')).data.map(t => t.ref)).toEqual([theirs.ref])

    // Any other value is a User ID (issue 10). An unknown ID matches nothing.
    expect((await list(me, '?assignee=someone')).data).toEqual([])
  })
})
