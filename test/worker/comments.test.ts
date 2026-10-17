import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, connectMcp, getMcpToken, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>

interface Ticket { number: number, ref: string, comment_count: number, fields: Record<string, unknown>, status: { key: string }, priority: string, assignee: { id: string } | null }
interface Comment { id: string, visibility: string, body: string, channel: string }
interface Event { type: 'event', id: string, action: string, channel: string, principal: { id: string }, before: string | null, after: string | null, field: { key: string, label: string } | null, reverted: boolean, revertible: boolean, reverts_id: number | null }
type Item = Event | { type: 'comment', id: string, comment: Comment }
interface AuditRow { id: number, principal_id: string, channel: string, action: string, field_key: string | null, comment_id: string | null, reverts_id: number | null, before: string | null, after: string | null }

const headers = (s: Session) => ({ cookie: s.cookie })

async function create(s: Session, prefix = 'BUG', extra: Record<string, unknown> = {}) {
  const fields = prefix === 'BUG' ? { page_or_feature: 'Reports' } : {}
  const res = await postJson('/api/v1/tickets', { ticket_type_id: await typeId(s.cookie, prefix), title: 'A ticket', fields, ...extra }, headers(s))
  expect(res.status).toBe(201)
  return await res.json() as Ticket
}

const patch = (s: Session, ref: string, body: unknown) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: headers(s) })
const comment = (s: Session, ref: string, body: unknown) => postJson(`/api/v1/tickets/${ref}/comments`, body, headers(s))
const getTicket = async (s: Session, ref: string) => await (await call(`/api/v1/tickets/${ref}`, { headers: headers(s) })).json() as Ticket
const activity = async (s: Session, ref: string) => {
  const res = await call(`/api/v1/tickets/${ref}/activity`, { headers: headers(s) })
  expect(res.status).toBe(200)
  return (await res.json() as { data: Item[] }).data
}
const events = async (s: Session, ref: string) => (await activity(s, ref)).filter((i): i is Event => i.type === 'event')
const revert = (s: Session, ref: string, id: string | number) => postJson(`/api/v1/tickets/${ref}/activity/${id}/revert`, {}, headers(s))

async function audit(number: number) {
  const { results } = await env.DB.prepare('SELECT * FROM audit_log WHERE ticket_number = ? ORDER BY id').bind(number).all<AuditRow>()
  return results
}

describe('comments: visibility', () => {
  it('hides Internal Comments from the Requester in list, read, Activity and count', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    const internal = await (await comment(agent, t.ref, { body: 'Secret note', visibility: 'internal' })).json() as Comment
    const pub = await (await comment(agent, t.ref, { body: 'Hello there', visibility: 'public' })).json() as Comment
    expect([internal.visibility, pub.visibility]).toEqual(['internal', 'public'])

    const listed = (await (await call(`/api/v1/tickets/${t.ref}/comments`, { headers: headers(requester) })).json() as { data: Comment[] }).data
    expect(listed.map(c => c.body)).toEqual(['Hello there'])
    const hidden = await call(`/api/v1/tickets/${t.ref}/comments/${internal.id}`, { headers: headers(requester) })
    const missing = await call(`/api/v1/tickets/${t.ref}/comments/${crypto.randomUUID()}`, { headers: headers(requester) })
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual(await missing.json())
    expect((await call(`/api/v1/tickets/${t.ref}/comments/${pub.id}`, { headers: headers(requester) })).status).toBe(200)

    const items = await activity(requester, t.ref)
    expect(items.filter(i => i.type === 'comment').map(i => (i as { comment: Comment }).comment.body)).toEqual(['Hello there'])
    expect(JSON.stringify(items)).not.toContain('Secret note')
    expect((await getTicket(requester, t.ref)).comment_count).toBe(1)

    // The Agent sees both.
    expect((await getTicket(agent, t.ref)).comment_count).toBe(2)
    expect((await activity(agent, t.ref)).filter(i => i.type === 'comment')).toHaveLength(2)
  })

  it('makes an Agent comment without a visibility Internal, and a Requester comment Public', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    const byAgent = await comment(agent, t.ref, { body: 'No visibility given' })
    expect(byAgent.status).toBe(201)
    expect((await byAgent.json() as Comment).visibility).toBe('internal')
    expect((await (await comment(requester, t.ref, { body: 'From me' })).json() as Comment).visibility).toBe('public')
  })

  it('refuses an Internal Comment from a Requester, and a comment on a ticket they cannot read', async () => {
    const [requester, other] = await Promise.all([signInAs('requester'), signInAs('requester')])
    const t = await create(requester)
    const refused = await comment(requester, t.ref, { body: 'x', visibility: 'internal' })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Only Agents can write Internal Comments.', details: null } })
    expect((await comment(other, t.ref, { body: 'x' })).status).toBe(404)
    expect((await call(`/api/v1/tickets/${t.ref}/activity`, { headers: headers(other) })).status).toBe(404)
  })

  it('validates the body and the visibility', async () => {
    const agent = await signInAs('agent')
    const t = await create(agent)
    expect((await comment(agent, t.ref, { body: '   ' })).status).toBe(422)
    expect((await comment(agent, t.ref, { body: 'ok', visibility: 'secret' })).status).toBe(422)
  })
})

describe('audit log: one entry for each change, with Principal and channel', () => {
  it('writes entries for create, Status, Priority, assignee, Field value and comment', async () => {
    const agent = await signInAs('agent')
    const t = await create(agent)
    expect((await patch(agent, t.ref, { status: 'in_progress', priority: 'high', assignee_id: agent.user.id, fields: { page_or_feature: 'Billing' } })).status).toBe(200)
    const c = await (await comment(agent, t.ref, { body: 'Note' })).json() as Comment

    const rows = await audit(t.number)
    expect(rows.map(r => [r.action, r.field_key])).toEqual([
      ['ticket_created', null], ['status_changed', null], ['priority_changed', null], ['assignee_changed', null], ['field_changed', 'page_or_feature'], ['comment_added', null],
    ])
    for (const r of rows) expect([r.principal_id, r.channel]).toEqual([agent.user.id, 'web'])
    expect(rows.slice(1, 5).map(r => [r.before, r.after])).toEqual([
      ['"open"', '"in_progress"'], ['"normal"', '"high"'], ['null', JSON.stringify(agent.user.id)], ['"Reports"', '"Billing"'],
    ])
    // The comment body is not in the log: the entry only points to the comment.
    expect(rows[5]).toMatchObject({ comment_id: c.id, before: null, after: null })
    expect(JSON.stringify(rows)).not.toContain('Note')
    expect((await getTicket(agent, t.ref)).fields).toEqual({ page_or_feature: 'Billing' })
  })

  it('writes no entry for a request that changes nothing or fails', async () => {
    const agent = await signInAs('agent')
    const t = await create(agent)
    await patch(agent, t.ref, { status: 'open', priority: 'normal' })
    expect((await patch(agent, t.ref, { status: 'nope', priority: 'high' })).status).toBe(422)
    expect((await patch(agent, t.ref, { fields: { page_or_feature: '' } })).status).toBe(422)
    expect((await patch(agent, t.ref, { fields: { unknown_key: 'x' } })).status).toBe(422)
    expect((await audit(t.number)).map(r => r.action)).toEqual(['ticket_created'])
  })

  it('records the channel "ai" for changes through MCP', async () => {
    const agent = await signInAs('agent')
    const client = await connectMcp((await getMcpToken(agent.cookie)).access_token)
    const typeIdBug = await typeId(agent.cookie, 'GEN')
    const made = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: typeIdBug, title: 'Via Claude' } })
    const ref = (made.structuredContent as { ref: string }).ref
    await client.callTool({ name: 'change_status', arguments: { ticket: ref, status: 'waiting' } })
    await client.callTool({ name: 'change_priority', arguments: { ticket: ref, priority: 'urgent' } })
    await client.callTool({ name: 'assign_ticket', arguments: { ticket: ref, assignee: 'me' } })
    const rows = await audit(Number(ref.split('-')[1]))
    expect(rows.map(r => [r.action, r.channel, r.principal_id])).toEqual([
      ['ticket_created', 'ai', agent.user.id], ['status_changed', 'ai', agent.user.id], ['priority_changed', 'ai', agent.user.id], ['assignee_changed', 'ai', agent.user.id],
    ])
  })

  it('refuses a Field edit from a Requester once the ticket is not open (issue 09)', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await patch(agent, t.ref, { status: 'in_progress' })
    const res = await patch(requester, t.ref, { fields: { page_or_feature: 'x' } })
    expect(res.status).toBe(403)
    expect((await res.json() as { error: { message: string } }).error.message).toBe('You can edit a ticket only while it is open. Add a comment instead.')
  })
})

describe('Activity', () => {
  it('mixes the log and the comments in time order, with readable values', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await patch(agent, t.ref, { status: 'in_progress', assignee_id: agent.user.id, fields: { frequency: 'Once' } })
    await comment(agent, t.ref, { body: 'Reply', visibility: 'public' })

    const items = await activity(requester, t.ref)
    expect(items.map(i => i.type === 'comment' ? 'comment' : i.action)).toEqual(['ticket_created', 'status_changed', 'assignee_changed', 'field_changed', 'comment'])
    const [, status, assignee, field] = items as Event[]
    expect([status!.before, status!.after]).toEqual(['Open', 'In progress'])
    expect(assignee!.after).toBe(agent.user.email)
    expect(field).toMatchObject({ field: { key: 'frequency', label: 'How often does it happen?' }, before: null, after: 'Once' })
    // A Requester cannot revert.
    expect((items as Event[]).filter(i => i.type === 'event').every(e => !e.revertible)).toBe(true)
  })
})

describe('Revert', () => {
  it('restores the previous value and adds a new entry', async () => {
    const agent = await signInAs('agent')
    const t = await create(agent)
    await patch(agent, t.ref, { priority: 'high' })
    const [, change] = await events(agent, t.ref)
    expect(change).toMatchObject({ action: 'priority_changed', revertible: true })

    const res = await revert(agent, t.ref, change!.id)
    expect(res.status).toBe(200)
    expect((await res.json() as Ticket).priority).toBe('normal')

    const rows = await audit(t.number)
    expect(rows).toHaveLength(3)
    expect(rows[2]).toMatchObject({ action: 'priority_changed', before: '"high"', after: '"normal"', reverts_id: rows[1]!.id, principal_id: agent.user.id })
    // History stays, and the reverted entry cannot be reverted again.
    const [, old, undo] = await events(agent, t.ref)
    expect([old!.reverted, old!.revertible, undo!.reverts_id, undo!.revertible]).toEqual([true, false, rows[1]!.id, true])
    const again = await revert(agent, t.ref, change!.id)
    expect(again.status).toBe(409)
    expect((await again.json() as { error: { code: string } }).error.code).toBe('VALUE_CHANGED')
  })

  it('reverts Status, assignee and a Field value', async () => {
    const agent = await signInAs('agent')
    const t = await create(agent)
    await patch(agent, t.ref, { status: 'waiting' })
    await patch(agent, t.ref, { assignee_id: agent.user.id })
    await patch(agent, t.ref, { fields: { frequency: 'Once' } })
    for (const e of (await events(agent, t.ref)).filter(e => e.revertible).reverse()) expect((await revert(agent, t.ref, e.id)).status).toBe(200)
    const after = await getTicket(agent, t.ref)
    expect([after.status.key, after.assignee, after.fields]).toEqual(['open', null, { page_or_feature: 'Reports' }])
  })

  it('refuses an entry whose value changed since', async () => {
    const agent = await signInAs('agent')
    const t = await create(agent)
    await patch(agent, t.ref, { priority: 'high' })
    await patch(agent, t.ref, { priority: 'urgent' })
    const [, first] = await events(agent, t.ref)
    expect(first!.revertible).toBe(false)
    const res = await revert(agent, t.ref, first!.id)
    expect(res.status).toBe(409)
    expect((await getTicket(agent, t.ref)).priority).toBe('urgent')
  })

  it('refuses an entry that is not reversible, one that does not exist, and a Requester', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await patch(agent, t.ref, { priority: 'high' })
    const [created, change] = await events(agent, t.ref)

    const notReversible = await revert(agent, t.ref, created!.id)
    expect(notReversible.status).toBe(409)
    expect((await notReversible.json() as { error: { code: string } }).error.code).toBe('NOT_REVERSIBLE')

    // Erased values (issue 22) make an entry not reversible.
    await env.DB.prepare('UPDATE audit_log SET before = NULL, after = NULL WHERE id = ?').bind(Number(change!.id)).run()
    expect((await revert(agent, t.ref, change!.id)).status).toBe(409)

    expect((await revert(agent, t.ref, 999_999_999)).status).toBe(404)
    const refused = await revert(requester, t.ref, change!.id)
    expect(refused.status).toBe(403)
    expect((await getTicket(agent, t.ref)).priority).toBe('high')
  })

  it('does not take an entry of another ticket', async () => {
    const agent = await signInAs('agent')
    const [a, b] = [await create(agent), await create(agent)]
    await patch(agent, a.ref, { priority: 'high' })
    const [, change] = await events(agent, a.ref)
    expect((await revert(agent, b.ref, change!.id)).status).toBe(404)
  })
})
