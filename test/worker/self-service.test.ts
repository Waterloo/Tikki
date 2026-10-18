import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/services'
import { REOPEN_WINDOW_MS, reopenTicket } from '../../server/utils/self-service'
import { call, createVisibleType, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>

interface Ticket {
  number: number
  ref: string
  description: string
  fields: Record<string, unknown>
  status: { key: string, category: string }
  allowed_actions: string[]
  reopened_from: { number: number, ref: string } | null
  title: string
  priority: string
}
interface Event { type: 'event', action: string, before: string | null, after: string | null, principal: { id: string }, channel: string }
interface AuditRow { action: string, principal_id: string, channel: string, before: string | null, after: string | null, created_at: number }

const headers = (s: Session) => ({ cookie: s.cookie })

async function create(s: Session, extra: Record<string, unknown> = {}) {
  const res = await postJson('/api/v1/tickets', {
    ticket_type_id: await typeId(s.cookie, 'BUG'),
    title: 'Reports are slow',
    description: 'Original text',
    fields: { page_or_feature: 'Reports' },
    priority: 'high',
    ...extra,
  }, headers(s))
  expect(res.status).toBe(201)
  return await res.json() as Ticket
}

const patch = (s: Session, ref: string, body: unknown) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: headers(s) })
const cancel = (s: Session, ref: string) => postJson(`/api/v1/tickets/${ref}/cancel`, {}, headers(s))
const reopen = (s: Session, ref: string) => postJson(`/api/v1/tickets/${ref}/reopen`, {}, headers(s))
const getTicket = async (s: Session, ref: string) => await (await call(`/api/v1/tickets/${ref}`, { headers: headers(s) })).json() as Ticket

async function audit(number: number) {
  const { results } = await env.DB.prepare('SELECT * FROM audit_log WHERE ticket_number = ? ORDER BY id').bind(number).all<AuditRow>()
  return results
}

/** Resolves the ticket as an Agent, like the real flow. */
async function resolve(agent: Session, ref: string) {
  expect((await patch(agent, ref, { status: 'resolved' })).status).toBe(200)
}

/** Moves every audit entry of the ticket back in time, to age the resolution without sleeping. */
async function age(number: number, ms: number) {
  await env.DB.prepare('UPDATE audit_log SET created_at = created_at - ? WHERE ticket_number = ?').bind(ms, number).run()
}

const DAY = 24 * 60 * 60 * 1000

describe('Requester edit', () => {
  it('edits the description and a Field while open, and refuses it after an Agent moves the ticket on', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    expect(t.allowed_actions).toEqual(expect.arrayContaining(['edit_description', 'edit_fields', 'cancel', 'comment']))
    expect(t.allowed_actions).not.toContain('reopen')

    const edited = await patch(requester, t.ref, { description: 'Corrected text', fields: { page_or_feature: 'Billing' } })
    expect(edited.status).toBe(200)
    const body = await edited.json() as Ticket
    expect(body.description).toBe('Corrected text')
    expect(body.fields.page_or_feature).toBe('Billing')

    expect((await patch(agent, t.ref, { status: 'in_progress' })).status).toBe(200)
    for (const change of [{ description: 'Too late' }, { fields: { page_or_feature: 'Late' } }]) {
      const refused = await patch(requester, t.ref, change)
      expect(refused.status).toBe(403)
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    }
    const after = await getTicket(requester, t.ref)
    expect(after.description).toBe('Corrected text')
    expect(after.allowed_actions).toEqual(['comment', 'cancel'])
  })

  it('allows an edit only in the open Category: refused while waiting, allowed again when open', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    expect((await patch(agent, t.ref, { status: 'waiting' })).status).toBe(200)
    expect((await patch(requester, t.ref, { description: 'x' })).status).toBe(403)
    // Back to open: allowed again.
    expect((await patch(agent, t.ref, { status: 'open' })).status).toBe(200)
    expect((await patch(requester, t.ref, { description: 'x' })).status).toBe(200)
  })

  it('refuses status, priority and assignee from a Requester, even with an allowed description in the same request', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    const refused = await patch(requester, t.ref, { description: 'new', priority: 'low' })
    expect(refused.status).toBe(403)
    expect((await getTicket(requester, t.ref)).description).toBe('Original text')
  })

  it('validates a sent Field and keeps an empty description change as no change', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    const bad = await patch(requester, t.ref, { fields: { page_or_feature: '' } })
    expect(bad.status).toBe(422)
    const same = await patch(requester, t.ref, { description: 'Original text' })
    expect(same.status).toBe(200)
    expect((await audit(t.number)).map(e => e.action)).toEqual(['ticket_created'])
  })

  it('writes one audit entry for each edit, without the description text in the Activity', async () => {
    const requester = await signInAs('requester')
    const t = await create(requester)
    await patch(requester, t.ref, { description: 'Secret new text', fields: { page_or_feature: 'Billing' } })
    const entries = await audit(t.number)
    expect(entries.map(e => e.action)).toEqual(['ticket_created', 'description_changed', 'field_changed'])
    expect(entries[1]).toMatchObject({ principal_id: requester.user.id, channel: 'web', before: '"Original text"', after: '"Secret new text"' })
    const activity = await (await call(`/api/v1/tickets/${t.ref}/activity`, { headers: headers(requester) })).json() as { data: Event[] }
    expect(JSON.stringify(activity)).not.toContain('Secret new text')
    expect(activity.data.find(e => e.action === 'description_changed')).toMatchObject({ before: null, after: null })
  })
})

describe('Requester cancel', () => {
  it('closes the ticket with the reason and writes audit entries', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await patch(agent, t.ref, { status: 'in_progress' })
    const res = await cancel(requester, t.ref)
    expect(res.status).toBe(200)
    const body = await res.json() as Ticket
    expect(body.status.key).toBe('closed')
    expect(body.allowed_actions).toEqual(['comment'])

    const entries = await audit(t.number)
    expect(entries.map(e => e.action)).toEqual(['ticket_created', 'status_changed', 'ticket_cancelled', 'comment_added'])
    expect(entries[2]).toMatchObject({ principal_id: requester.user.id, channel: 'web', before: '"in_progress"', after: '"closed"' })

    // The reason is a Public Comment, so the Requester and the Agent both read it.
    for (const s of [requester, agent]) {
      const comments = await (await call(`/api/v1/tickets/${t.ref}/comments`, { headers: headers(s) })).json() as { data: { body: string, visibility: string }[] }
      expect(comments.data).toEqual([expect.objectContaining({ body: 'Ticket cancelled by requester.', visibility: 'public' })])
    }
  })

  it('is refused when the ticket is already done', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await resolve(agent, t.ref)
    const refused = await cancel(requester, t.ref)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'A ticket that is done cannot be cancelled.', details: null } })
    // Closed is done too: a second cancel is refused, and the ticket stays as it is.
    await patch(agent, t.ref, { status: 'closed' })
    expect((await cancel(requester, t.ref)).status).toBe(403)
    const t2 = await create(requester)
    expect((await cancel(requester, t2.ref)).status).toBe(200)
    expect((await cancel(requester, t2.ref)).status).toBe(403)
  })
})

describe('Requester reopen', () => {
  it('returns the ticket to open within 14 days', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await resolve(agent, t.ref)
    expect((await getTicket(requester, t.ref)).allowed_actions).toEqual(['comment', 'reopen'])
    await age(t.number, 13 * DAY)

    const res = await reopen(requester, t.ref)
    expect(res.status).toBe(200)
    const body = await res.json() as Ticket
    expect(body.ref).toBe(t.ref)
    expect(body.status.key).toBe('open')
    expect(body.reopened_from).toBeNull()
    const last = (await audit(t.number)).at(-1)!
    expect(last).toMatchObject({ action: 'ticket_reopened', principal_id: requester.user.id, before: '"resolved"', after: '"open"' })
  })

  it('creates a linked new ticket after 14 days and leaves the old one resolved', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await resolve(agent, t.ref)
    await age(t.number, 15 * DAY)

    const res = await reopen(requester, t.ref)
    expect(res.status).toBe(201)
    const fresh = await res.json() as Ticket
    expect(fresh.number).not.toBe(t.number)
    expect(fresh).toMatchObject({ title: t.title, description: 'Original text', priority: 'high', fields: { page_or_feature: 'Reports' }, status: { key: 'open' } })
    expect(fresh.reopened_from).toEqual({ number: t.number, ref: t.ref })
    expect((await getTicket(requester, t.ref)).status.key).toBe('resolved')

    expect((await audit(fresh.number)).map(e => e.action)).toEqual(['ticket_created'])
    expect((await audit(t.number)).at(-1)).toMatchObject({ action: 'ticket_reopened', principal_id: requester.user.id })
    // The old ticket is still resolved, so a second reopen makes a second new ticket.
    expect((await reopen(requester, t.ref)).status).toBe(201)
  })

  it('uses the test clock: 14 days exactly is inside, one millisecond more is outside', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const principal = { kind: 'user', userId: requester.user.id, role: 'requester', channel: 'web' } as const
    const inside = await create(requester)
    await resolve(agent, inside.ref)
    const [{ at }] = (await env.DB.prepare('SELECT created_at AS at FROM audit_log WHERE ticket_number = ? AND action = ?').bind(inside.number, 'status_changed').all<{ at: number }>()).results as [{ at: number }]
    expect((await reopenTicket(db, principal, inside.number, new Date(at + REOPEN_WINDOW_MS))).created).toBe(false)

    const outside = await create(requester)
    await resolve(agent, outside.ref)
    const [{ at: at2 }] = (await env.DB.prepare('SELECT created_at AS at FROM audit_log WHERE ticket_number = ? AND action = ?').bind(outside.number, 'status_changed').all<{ at: number }>()).results as [{ at: number }]
    expect((await reopenTicket(db, principal, outside.number, new Date(at2 + REOPEN_WINDOW_MS + 1))).created).toBe(true)
  })

  it('counts from the latest resolution, not from the creation', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await resolve(agent, t.ref)
    await age(t.number, 30 * DAY)
    await patch(agent, t.ref, { status: 'open' })
    await resolve(agent, t.ref)
    expect((await reopen(requester, t.ref)).status).toBe(200)
  })

  it('is refused for a ticket that is not resolved', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    expect((await reopen(requester, t.ref)).status).toBe(403)
    await patch(agent, t.ref, { status: 'closed' })
    expect((await reopen(requester, t.ref)).status).toBe(403)
  })
})

describe("another person's ticket", () => {
  it('answers 404 on a private ticket and 403 on a visible one, for edit, cancel and reopen', async () => {
    const [owner, other, agent] = await Promise.all([signInAs('requester'), signInAs('requester'), signInAs('agent')])
    const t = await create(owner)
    await resolve(agent, t.ref)
    const open = await create(owner)
    for (const refused of [
      await patch(other, open.ref, { description: 'hijack' }),
      await cancel(other, open.ref),
      await reopen(other, t.ref),
    ]) {
      expect(refused.status).toBe(404)
    }
    expect((await getTicket(owner, open.ref)).description).toBe('Original text')
    expect((await getTicket(owner, t.ref)).status.key).toBe('resolved')

    // On a ticket of a type that is visible to all, the other Requester can read it but still cannot act.
    const shared = await createVisibleType()
    const created = await postJson('/api/v1/tickets', { ticket_type_id: shared, title: 'Notice' }, headers(owner))
    const visible = await created.json() as Ticket
    expect((await getTicket(other, visible.ref)).allowed_actions).toEqual(['comment'])
    expect((await patch(other, visible.ref, { description: 'hijack' })).status).toBe(403)
    expect((await patch(other, visible.ref, { fields: { office: 'x' } })).status).toBe(403)
    expect((await cancel(other, visible.ref)).status).toBe(403)
    await resolve(agent, visible.ref)
    expect((await reopen(other, visible.ref)).status).toBe(403)
    expect((await getTicket(owner, visible.ref)).status.key).toBe('resolved')
  })

  it('does not let an Agent cancel or reopen for the Requester', async () => {
    const [owner, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(owner)
    expect((await cancel(agent, t.ref)).status).toBe(403)
    await resolve(agent, t.ref)
    expect((await reopen(agent, t.ref)).status).toBe(403)
    expect((await getTicket(agent, t.ref)).allowed_actions).not.toContain('cancel')
  })
})
