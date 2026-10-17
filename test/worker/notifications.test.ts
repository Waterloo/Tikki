import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { notifyAdmins } from '../../server/utils/notifications'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../server/db/schema'
import { call, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>
interface Ticket { number: number, ref: string }
interface Notice { id: number, kind: string, head: string, body: string, href: string, read: boolean }
interface List { data: Notice[], unread_count: number, next_cursor: number | null }

const h = (s: Session) => ({ cookie: s.cookie })

async function create(s: Session) {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: await typeId(s.cookie, 'GEN'), title: 'Needs help' }, h(s))
  expect(res.status).toBe(201)
  return await res.json() as Ticket
}
const patch = (s: Session, ref: string, body: unknown) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: h(s) })
const comment = (s: Session, ref: string, body: unknown) => postJson(`/api/v1/tickets/${ref}/comments`, body, h(s))
const list = async (s: Session, query = '') => await (await call(`/api/v1/notifications${query}`, { headers: h(s) })).json() as List

/** Who got a notice of this kind for this ticket. */
async function recipients(number: number, kind: string) {
  const { results } = await env.DB.prepare('SELECT user_id FROM notification WHERE ticket_number = ? AND kind = ? ORDER BY user_id').bind(number, kind).all<{ user_id: string }>()
  return results.map(r => r.user_id).sort()
}
async function staffIds(except: string[] = []) {
  const { results } = await env.DB.prepare("SELECT id FROM user WHERE role IN ('admin', 'agent')").all<{ id: string }>()
  return results.map(r => r.id).filter(id => !except.includes(id)).sort()
}
const ids = (...s: Session[]) => s.map(x => x.user.id).sort()

describe('notices: fan-out', () => {
  it('ticket created: every Agent and Admin but the actor; not the Requester', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    expect(await recipients(t.number, 'ticket_created')).toEqual(await staffIds())
    expect(await recipients(t.number, 'ticket_created')).not.toContain(requester.user.id)

    // The actor is never told about their own change.
    const own = await create(agent)
    expect(await recipients(own.number, 'ticket_created')).toEqual(await staffIds([agent.user.id]))

    const seen = await list(agent)
    expect(seen.data.find(n => n.href === `/tickets/${t.ref}`)).toMatchObject({ kind: 'ticket_created', head: expect.stringContaining(`created ${t.ref}`), read: false })
  })

  it('ticket created: only the owning Team when it has members', async () => {
    const [requester, member, outsider] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    const teamId = (await env.DB.prepare("SELECT team_id FROM ticket_type WHERE prefix = 'GEN'").first<{ team_id: number }>())!.team_id
    await env.DB.prepare('INSERT INTO team_member (team_id, user_id, created_at) VALUES (?, ?, ?)').bind(teamId, member.user.id, Date.now()).run()
    try {
      const t = await create(requester)
      expect(await recipients(t.number, 'ticket_created')).toEqual(ids(member))
      expect(await recipients(t.number, 'ticket_created')).not.toContain(outsider.user.id)
    } finally {
      await env.DB.prepare('DELETE FROM team_member WHERE team_id = ?').bind(teamId).run()
    }
  })

  it('assigned: the new assignee only, and nobody who assigns themselves', async () => {
    const [requester, agent, other] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    const t = await create(requester)
    expect((await patch(agent, t.ref, { assignee_id: other.user.id })).status).toBe(200)
    expect(await recipients(t.number, 'assigned')).toEqual(ids(other))
    expect((await list(other)).data.find(n => n.kind === 'assigned')?.head).toContain(`assigned ${t.ref} to you`)

    const t2 = await create(requester)
    await patch(agent, t2.ref, { assignee_id: agent.user.id })
    expect(await recipients(t2.number, 'assigned')).toEqual([])
  })

  it('Public Comment: the Requester and the assignee, not the author', async () => {
    const [requester, agent, other] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    const t = await create(requester)
    await patch(agent, t.ref, { assignee_id: other.user.id })

    await comment(agent, t.ref, { body: 'We are on it', visibility: 'public' })
    expect(await recipients(t.number, 'public_comment')).toEqual(ids(requester, other))

    // The Requester replies: only the assignee is told.
    await env.DB.prepare('DELETE FROM notification WHERE kind = ? AND ticket_number = ?').bind('public_comment', t.number).run()
    await comment(requester, t.ref, { body: 'Thanks' })
    expect(await recipients(t.number, 'public_comment')).toEqual(ids(other))
    expect((await list(other)).data[0]).toMatchObject({ kind: 'public_comment', body: 'Thanks' })
  })

  it('Internal Comment: the assignee only. A Requester never gets one', async () => {
    const [requester, agent, other] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    const t = await create(requester)
    // Without an assignee nobody is told.
    await comment(agent, t.ref, { body: 'Secret one', visibility: 'internal' })
    expect(await recipients(t.number, 'internal_comment')).toEqual([])

    await patch(agent, t.ref, { assignee_id: other.user.id })
    await comment(agent, t.ref, { body: 'Secret two', visibility: 'internal' })
    expect(await recipients(t.number, 'internal_comment')).toEqual(ids(other))

    // The assignee comments: the author is not told.
    await comment(other, t.ref, { body: 'Secret three', visibility: 'internal' })
    expect(await recipients(t.number, 'internal_comment')).toEqual(ids(other))

    const mine = await list(requester)
    expect(mine.data.some(n => n.kind === 'internal_comment')).toBe(false)
    expect(JSON.stringify(mine)).not.toContain('Secret')

    // A Requester is refused an Internal Comment, so no notice is written either.
    expect((await comment(requester, t.ref, { body: 'Sneaky', visibility: 'internal' })).status).toBe(403)
    expect(await recipients(t.number, 'internal_comment')).toEqual(ids(other))
  })

  it('Status changed: the Requester, with the new Status name', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    expect((await patch(agent, t.ref, { status: 'in_progress' })).status).toBe(200)
    expect(await recipients(t.number, 'status_changed')).toEqual(ids(requester))
    const notice = (await list(requester)).data.find(n => n.kind === 'status_changed')
    expect(notice?.head).toMatch(new RegExp(`changed ${t.ref} to In progress`))
    // A change of Priority tells nobody.
    await patch(agent, t.ref, { priority: 'high' })
    expect((await list(requester)).data.filter(n => n.href === `/tickets/${t.ref}` && n.kind === 'status_changed')).toHaveLength(1)
  })

  it('webhook endpoint failing or disabled: Admins only (notifyAdmins)', async () => {
    const [admin, agent] = await Promise.all([signInAs('admin'), signInAs('agent')])
    await notifyAdmins(drizzle(env.DB, { schema }), 'webhook_failing', { head: 'Webhook "n8n" is failing', body: '6 tries since 09:40.', href: '/settings/webhooks' })
    expect((await list(admin)).data[0]).toMatchObject({ kind: 'webhook_failing', head: 'Webhook "n8n" is failing', href: '/settings/webhooks' })
    expect((await list(agent)).data.some(n => n.kind === 'webhook_failing')).toBe(false)
  })
})

describe('Inbox', () => {
  it('lists only the own notices, filters Unread, and Mark all as read sets the count to 0', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await create(requester)
    expect((await list(agent)).unread_count).toBeGreaterThanOrEqual(2)
    expect((await list(requester)).data).toEqual([])

    const count = await (await call('/api/v1/notifications/unread-count', { headers: h(agent) })).json() as { count: number }
    expect(count.count).toBe((await list(agent)).unread_count)

    // Open one notice: it is read, the others stay unread.
    const first = (await list(agent)).data[0]!
    const one = await (await postJson(`/api/v1/notifications/${first.id}/read`, {}, h(agent))).json() as { unread_count: number }
    expect(one.unread_count).toBe(count.count - 1)
    const unread = await list(agent, '?filter=unread')
    expect(unread.data.every(n => !n.read)).toBe(true)
    expect(unread.data.some(n => n.id === first.id)).toBe(false)

    // Another User cannot mark it.
    expect((await postJson(`/api/v1/notifications/${first.id}/read`, {}, h(requester))).status).toBe(404)

    const res = await postJson('/api/v1/notifications/read-all', {}, h(agent))
    expect(await res.json()).toEqual({ unread_count: 0 })
    const after = await list(agent)
    expect(after.unread_count).toBe(0)
    expect((await list(agent, '?filter=unread')).data).toEqual([])
    expect(after.data.length).toBeGreaterThan(0)
    expect(t.ref).toBeTruthy()
  })

  it('pages with a cursor', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    await create(requester)
    await create(requester)
    await create(requester)
    const page1 = await list(agent, '?limit=2')
    expect(page1.data).toHaveLength(2)
    expect(page1.next_cursor).toBe(page1.data[1]!.id)
    const page2 = await list(agent, `?limit=2&cursor=${page1.next_cursor}`)
    expect(page2.data[0]!.id).toBeLessThan(page1.data[1]!.id)
  })

  it('needs a sign-in', async () => {
    expect((await call('/api/v1/notifications')).status).toBe(401)
    expect((await call('/api/v1/notifications/unread-count')).status).toBe(401)
  })
})

describe('preferences', () => {
  const prefs = async (s: Session) => (await (await call('/api/v1/notifications/preferences', { headers: h(s) })).json() as { data: { key: string, enabled: boolean, locked: boolean }[] }).data
  const set = (s: Session, body: unknown) => call('/api/v1/notifications/preferences', { method: 'PATCH', body: JSON.stringify(body), headers: h(s) })

  it('stores the switches for each User', async () => {
    const [a, b] = await Promise.all([signInAs('agent'), signInAs('agent')])
    expect((await prefs(a)).find(p => p.key === 'internal_comment')?.enabled).toBe(false)
    const res = await set(a, { internal_comment: true, team_ticket: false })
    expect(res.status).toBe(200)
    const after = await prefs(a)
    expect(after.find(p => p.key === 'internal_comment')?.enabled).toBe(true)
    expect(after.find(p => p.key === 'team_ticket')?.enabled).toBe(false)
    expect((await prefs(b)).find(p => p.key === 'team_ticket')?.enabled).toBe(true)
    // The value can be changed again.
    await set(a, { team_ticket: true })
    expect((await prefs(a)).find(p => p.key === 'team_ticket')?.enabled).toBe(true)
  })

  it('"Assigned to me" is always on and cannot be turned off', async () => {
    const agent = await signInAs('agent')
    expect((await prefs(agent)).find(p => p.key === 'assigned')).toEqual({ key: 'assigned', enabled: true, locked: true })
    const res = await set(agent, { assigned: false })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { details: { key: string }[] } }).error.details[0]!.key).toBe('assigned')
    expect((await prefs(agent)).find(p => p.key === 'assigned')?.enabled).toBe(true)
    // Nothing else in a refused request is stored.
    expect((await set(agent, { public_comment: false, assigned: false })).status).toBe(422)
    expect((await prefs(agent)).find(p => p.key === 'public_comment')?.enabled).toBe(true)
  })

  it('shows only the switches that fit the role, and refuses the others', async () => {
    const [requester, admin] = await Promise.all([signInAs('requester'), signInAs('admin')])
    expect((await prefs(requester)).map(p => p.key)).toEqual(['public_comment', 'status_changed'])
    expect((await prefs(admin)).map(p => p.key)).toContain('webhook')
    expect((await set(requester, { internal_comment: true })).status).toBe(422)
    expect((await set(requester, { public_comment: 'yes' })).status).toBe(422)
    expect((await set(requester, {})).status).toBe(422)
  })
})
