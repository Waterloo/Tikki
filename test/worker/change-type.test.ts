import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, connectMcp, getMcpToken, postJson, signInAs } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>

interface Ticket { number: number, ref: string, fields: Record<string, unknown>, schema_version: number, team: { name: string }, ticket_type: { id: number, prefix: string }, allowed_actions: string[], status: { key: string } }
interface TypeDetail { id: number, prefix: string }
interface Event { type: 'event', action: string, before: string | null, after: string | null, erased: boolean, revertible: boolean, unmoved: { key: string, label: string, value: string }[] }

let counter = 0
/** A new type with these Fields, so each test owns its types. */
async function makeType(admin: Session, fields: Record<string, unknown>[], extra: Record<string, unknown> = {}): Promise<TypeDetail> {
  const n = counter++
  const prefix = `X${String.fromCharCode(65 + Math.floor(n / 26) % 26)}${String.fromCharCode(65 + n % 26)}`
  const res = await postJson('/api/v1/ticket-types', { name: `Change test ${prefix}`, prefix, description: 'For tests.', visibility: 'internal', fields, ...extra }, { cookie: admin.cookie })
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as TypeDetail
}

const text = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: key, type: 'short_text', required: false, help: '', ...extra })

async function makeTicket(s: Session, type: TypeDetail, fields: Record<string, unknown> = {}) {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: type.id, title: 'Moves around', fields }, { cookie: s.cookie })
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Ticket
}

const changeType = (s: Session, ref: string, ticket_type_id: unknown) =>
  call(`/api/v1/tickets/${ref}/type`, { method: 'PUT', body: JSON.stringify({ ticket_type_id }), headers: { cookie: s.cookie } })
const read = async (s: Session, ref: string) => await (await call(`/api/v1/tickets/${ref}`, { headers: { cookie: s.cookie } })).json() as Ticket
const events = async (s: Session, ref: string) =>
  ((await (await call(`/api/v1/tickets/${ref}/activity`, { headers: { cookie: s.cookie } })).json()) as { data: { type: string }[] }).data.filter((i): i is Event => i.type === 'event')

describe('change Ticket Type', () => {
  it('keeps the number, moves matching values, and records the others in one audit entry', async () => {
    const [admin, agent] = await Promise.all([signInAs('admin'), signInAs('agent')])
    const from = await makeType(admin, [text('order_id'), text('note'), { key: 'when', label: 'When', type: 'date', required: false, help: '' }, { key: 'size', label: 'Size', type: 'single_select', required: false, help: '', options: ['S', 'M'] }])
    const to = await makeType(admin, [text('order_id'), { key: 'when', label: 'When', type: 'short_text', required: false, help: '' }, { key: 'size', label: 'Size', type: 'single_select', required: false, help: '', options: ['L'] }, text('extra', { required: true })], { team_id: (await env.DB.prepare("INSERT INTO team (name, created_at) VALUES (?, ?) RETURNING id").bind(`Team ${counter}`, Date.now()).first<{ id: number }>())!.id })
    const t = await makeTicket(agent, from, { order_id: '88412', note: 'Call back', when: '2026-10-02', size: 'S' })

    const res = await changeType(agent, t.ref, to.id)
    expect(res.status, await res.clone().text()).toBe(200)
    const moved = await res.json() as Ticket
    expect(moved).toMatchObject({ number: t.number, ref: `${to.prefix}-${t.number}`, schema_version: 1, fields: { order_id: '88412' }, status: { key: 'open' } })
    expect(moved.team).not.toEqual(t.team)

    const [entry] = (await env.DB.prepare("SELECT * FROM audit_log WHERE ticket_number = ? AND action = 'type_changed'").bind(t.number).all<{ before: string, after: string, principal_id: string }>()).results
    expect(entry!.principal_id).toBe(agent.user.id)
    expect(JSON.parse(entry!.after)).toEqual({ type: `Change test ${to.prefix}`, ref: moved.ref })
    const before = JSON.parse(entry!.before) as { ref: string, unmoved: { key: string, value: unknown }[] }
    expect(before.ref).toBe(t.ref)
    expect(before.unmoved.map(u => [u.key, u.value])).toEqual([['note', 'Call back'], ['when', '2026-10-02'], ['size', 'S']])

    const shown = (await events(agent, moved.ref)).find(e => e.action === 'type_changed')!
    expect(shown).toMatchObject({ erased: false, revertible: false, before: `Change test ${from.prefix} (${t.ref})`, after: `Change test ${to.prefix} (${moved.ref})` })
    expect(shown.unmoved.map(u => u.label)).toEqual(['note', 'When', 'Size'])
  })

  it('resolves the old and the new reference to the same ticket, in REST, search and MCP', async () => {
    const admin = await signInAs('admin')
    const from = await makeType(admin, [])
    const to = await makeType(admin, [])
    const t = await makeTicket(admin, from)
    const after = await (await changeType(admin, t.ref, to.id)).json() as Ticket
    expect(after.ref).not.toBe(t.ref)

    for (const ref of [t.ref, after.ref, String(t.number), t.ref.toLowerCase()]) {
      const res = await call(`/api/v1/tickets/${ref}`, { headers: { cookie: admin.cookie } })
      expect(res.status, ref).toBe(200)
      expect((await res.json() as Ticket).number).toBe(t.number)
    }
    for (const q of [t.ref, after.ref]) {
      const list = await (await call(`/api/v1/tickets?q=${q}`, { headers: { cookie: admin.cookie } })).json() as { data: Ticket[] }
      expect(list.data.map(x => x.number), q).toEqual([t.number])
    }

    const { access_token } = await getMcpToken(admin.cookie)
    const client = await connectMcp(access_token)
    const back = await client.callTool({ name: 'change_ticket_type', arguments: { ticket: t.ref, ticket_type_id: from.id } })
    expect(back.isError, JSON.stringify(back)).toBeFalsy()
    expect(back.structuredContent).toMatchObject({ number: t.number, ref: t.ref })
    // The reference from before the second change still works in MCP.
    const again = await client.callTool({ name: 'change_ticket_type', arguments: { ticket: after.ref, ticket_type_id: to.id } })
    expect(again.structuredContent).toMatchObject({ ref: after.ref })
    const tools = (await client.listTools()).tools
    expect(tools.find(x => x.name === 'change_ticket_type')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true })
    await client.close()
  })

  it('keeps a file Field and its attachment when the new type has the same file Field', async () => {
    const admin = await signInAs('admin')
    const file = { key: 'receipt', label: 'Receipt', type: 'file', required: false, help: '' }
    const from = await makeType(admin, [file])
    const to = await makeType(admin, [file])
    const up = await call('/api/v1/attachments', { method: 'PUT', body: new TextEncoder().encode('pdf'), headers: { cookie: admin.cookie, 'x-filename': 'r.txt', 'content-type': 'text/plain' } })
    const { id } = await up.json() as { id: string }
    const t = await makeTicket(admin, from, { receipt: id })

    const moved = await (await changeType(admin, t.ref, to.id)).json() as Ticket
    expect(moved.fields).toEqual({ receipt: id })
    expect((await call(`/api/v1/attachments/${id}`, { headers: { cookie: admin.cookie } })).status).toBe(200)
    const list = await (await call(`/api/v1/tickets/${moved.ref}/attachments`, { headers: { cookie: admin.cookie } })).json() as { data: { id: string }[] }
    expect(list.data.map(a => a.id)).toEqual([id])
  })

  it('allows a required Field of the new type to stay empty', async () => {
    const admin = await signInAs('admin')
    const from = await makeType(admin, [])
    const to = await makeType(admin, [text('must', { required: true })])
    const t = await makeTicket(admin, from)
    const res = await changeType(admin, t.ref, to.id)
    expect(res.status).toBe(200)
    expect((await res.json() as Ticket).fields).toEqual({})
  })

  it('refuses a Requester, even for their own ticket, and does not change it', async () => {
    const [admin, requester] = await Promise.all([signInAs('admin'), signInAs('requester')])
    const from = await makeType(admin, [])
    const to = await makeType(admin, [])
    const t = await makeTicket(requester, from)
    expect((await read(requester, t.ref)).allowed_actions).not.toContain('change_type')
    const res = await changeType(requester, t.ref, to.id)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    expect((await read(requester, t.ref)).ref).toBe(t.ref)

    // A ticket the Requester cannot read answers 404, as for every other action.
    const hidden = await makeType(admin, [], { visibility: 'requester' })
    const secret = await makeTicket(admin, hidden)
    expect((await changeType(requester, secret.ref, to.id)).status).toBe(404)
  })

  it('refuses an archived, unknown, same, or malformed target', async () => {
    const admin = await signInAs('admin')
    const from = await makeType(admin, [])
    const archived = await makeType(admin, [])
    await call(`/api/v1/ticket-types/${archived.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }), headers: { cookie: admin.cookie } })
    const t = await makeTicket(admin, from)
    for (const target of [archived.id, 999999, from.id, 'x', null]) {
      const res = await changeType(admin, t.ref, target)
      expect(res.status, String(target)).toBe(422)
      expect(((await res.json()) as { error: { details: { key: string }[] } }).error.details[0]!.key).toBe('ticket_type_id')
    }
    expect((await read(admin, t.ref)).ticket_type.id).toBe(from.id)
  })

  it('cannot be reverted, and an erased entry still says that the type changed', async () => {
    const admin = await signInAs('admin')
    const from = await makeType(admin, [text('note')])
    const to = await makeType(admin, [])
    const t = await makeTicket(admin, from, { note: 'x' })
    await changeType(admin, t.ref, to.id)
    const { results } = await env.DB.prepare("SELECT id FROM audit_log WHERE ticket_number = ? AND action = 'type_changed'").bind(t.number).all<{ id: number }>()
    const revert = await postJson(`/api/v1/tickets/${t.ref}/activity/${results[0]!.id}/revert`, {}, { cookie: admin.cookie })
    expect(revert.status).toBe(409)

    await env.DB.prepare("UPDATE audit_log SET before = NULL, after = NULL WHERE ticket_number = ? AND action = 'type_changed'").bind(t.number).run()
    expect((await events(admin, t.ref)).find(e => e.action === 'type_changed')).toMatchObject({ erased: true, before: null, after: null, unmoved: [] })
  })
})

describe('change prefix', () => {
  const patch = (admin: Session, id: number, body: unknown) => call(`/api/v1/ticket-types/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { cookie: admin.cookie } })

  it('keeps the old prefix working and reserved', async () => {
    const admin = await signInAs('admin')
    const type = await makeType(admin, [])
    const other = await makeType(admin, [])
    const t = await makeTicket(admin, type)
    const old = type.prefix
    const next = `W${old.slice(1)}`

    expect((await patch(admin, type.id, { prefix: next })).status).toBe(200)
    const now = await read(admin, t.ref)
    expect(now.ref).toBe(`${next}-${t.number}`)
    for (const ref of [`${old}-${t.number}`, now.ref]) {
      expect((await read(admin, ref)).number, ref).toBe(t.number)
    }
    // The replaced prefix is reserved for other types, but its owner may take it back.
    const taken = await patch(admin, other.id, { prefix: old })
    expect(taken.status).toBe(422)
    expect(JSON.stringify(await taken.json())).toContain('stays reserved')
    expect((await patch(admin, type.id, { prefix: old })).status).toBe(200)
    expect((await read(admin, t.ref)).ref).toBe(`${old}-${t.number}`)
  })
})
