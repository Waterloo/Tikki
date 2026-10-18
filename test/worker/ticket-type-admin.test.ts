import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { validateFields, type FieldDef } from '../../server/utils/fields'
import { adminAuditOf, call, connectMcp, getMcpToken, postJson, signInAs } from './helpers'

interface Detail {
  id: number
  name: string
  prefix: string
  description: string
  icon: string
  color: string
  team: { id: number, name: string }
  visibility: string
  archived_at: string | null
  schema_version: number
  field_count: number
  open_tickets: number
  ticket_count: number
  fields: FieldDef[]
}

interface ErrorBody { error: { code: string, message: string, details: { key: string, reason: string, restore_type_id?: number }[] | null } }

type Session = Awaited<ReturnType<typeof signInAs>>

let counter = 0
/** A name and prefix that no other test in this file uses. */
function fresh() {
  const n = counter++
  const prefix = `Z${String.fromCharCode(65 + Math.floor(n / 26) % 26)}${String.fromCharCode(65 + n % 26)}`
  return { name: `Test type ${prefix}`, prefix }
}

const system = { label: 'System or tool', type: 'single_select', required: true, help: 'The system you need access to.', options: ['Wiki', 'VPN'] }
const until = { label: 'Needed until', type: 'date', help: 'Leave empty if permanent.' }

async function createType(admin: Session, body: Record<string, unknown> = {}) {
  const { name, prefix } = fresh()
  const res = await postJson('/api/v1/ticket-types', { name, prefix, description: 'Use it for tests.', ...body }, { cookie: admin.cookie })
  const copy = res.clone()
  return { res: copy, name, prefix, body: res.status === 201 ? await res.json() as Detail : await res.json() as ErrorBody }
}

async function created(admin: Session, body: Record<string, unknown> = {}) {
  const { res, body: detail } = await createType(admin, body)
  expect(res.status, JSON.stringify(detail)).toBe(201)
  return detail as Detail
}

function patch(admin: Session, id: number, body: unknown) {
  return call(`/api/v1/ticket-types/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { cookie: admin.cookie } })
}

async function detailOf(admin: Session, id: number) {
  const res = await call(`/api/v1/admin/ticket-types/${id}`, { headers: { cookie: admin.cookie } })
  expect(res.status).toBe(200)
  return await res.json() as Detail
}

async function expectProblem(res: Response, status: number, key: string, reason: RegExp) {
  const body = await res.json() as ErrorBody
  expect(res.status, JSON.stringify(body)).toBe(status)
  expect(body.error.details?.find(d => d.key === key)?.reason, JSON.stringify(body)).toMatch(reason)
  return body
}

async function createTicket(session: Session, ticketTypeId: number, fields: Record<string, unknown> = {}) {
  return postJson('/api/v1/tickets', { ticket_type_id: ticketTypeId, title: 'A ticket', fields }, { cookie: session.cookie })
}

describe('Ticket Type editor: who can use it', () => {
  it('answers 401 without a session and 403 for Requesters and Agents', async () => {
    expect((await call('/api/v1/admin/ticket-types')).status).toBe(401)
    expect((await postJson('/api/v1/ticket-types', {})).status).toBe(401)
    const admin = await signInAs('admin')
    const type = await created(admin)
    for (const role of ['requester', 'agent'] as const) {
      const other = await signInAs(role)
      const attempts = [
        call('/api/v1/admin/ticket-types', { headers: { cookie: other.cookie } }),
        call(`/api/v1/admin/ticket-types/${type.id}`, { headers: { cookie: other.cookie } }),
        postJson('/api/v1/ticket-types', { name: 'Sneaky', description: 'x' }, { cookie: other.cookie }),
        patch(other, type.id, { name: 'Renamed' }),
      ]
      for (const res of await Promise.all(attempts)) {
        expect(res.status, role).toBe(403)
        expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
      }
    }
    expect((await detailOf(admin, type.id)).name).toBe(type.name)
  })
})

describe('Ticket Type editor: create', () => {
  it('makes Schema Version 1 with the Fields, in one save, and the type can be used at once', async () => {
    const admin = await signInAs('admin')
    const requester = await signInAs('requester')
    const type = await created(admin, { name: 'Access request', prefix: 'acc', description: 'You need access to a system.', fields: [system, until] })
    expect(type).toMatchObject({ name: 'Access request', prefix: 'ACC', schema_version: 1, field_count: 2, open_tickets: 0, ticket_count: 0, archived_at: null, visibility: 'requester' })
    expect(type.fields).toEqual([
      { key: 'system_or_tool', label: 'System or tool', type: 'single_select', required: true, help: 'The system you need access to.', options: [{ value: 'Wiki' }, { value: 'VPN' }] },
      { key: 'needed_until', label: 'Needed until', type: 'date', required: false, help: 'Leave empty if permanent.' },
    ])

    const shown = await (await call(`/api/v1/ticket-types/${type.id}`, { headers: { cookie: requester.cookie } })).json() as { schema_version: number, fields: { key: string }[] }
    expect(shown.schema_version).toBe(1)
    expect(shown.fields.map(f => f.key)).toEqual(['system_or_tool', 'needed_until'])
    const ticket = await createTicket(requester, type.id, { system_or_tool: 'VPN' })
    expect(ticket.status).toBe(201)
    expect(await ticket.json()).toMatchObject({ ref: expect.stringMatching(/^ACC-\d+$/), schema_version: 1 })
  })

  it('suggests the prefix, icon and color when they are not sent, and uses a color that no other type uses', async () => {
    const admin = await signInAs('admin')
    const usedColors = async () => ((await (await call('/api/v1/admin/ticket-types', { headers: { cookie: admin.cookie } })).json()) as { data: Detail[] }).data.map(t => t.color)
    const before = await usedColors()
    const first = await created(admin, { name: 'Payments', prefix: undefined, description: 'A charge is wrong.' })
    expect(first).toMatchObject({ prefix: 'PAY', icon: 'i-lucide-credit-card' })
    expect(before).not.toContain(first.color)
    const second = await created(admin, { name: 'Procurement requests', prefix: undefined, description: 'Buy something.' })
    expect(second.prefix).toBe('PRO')
  })

  it('blocks a missing description, a bad prefix, icon, color, and Team, and saves nothing', async () => {
    const admin = await signInAs('admin')
    const before = (await (await call('/api/v1/admin/ticket-types', { headers: { cookie: admin.cookie } })).json() as { data: unknown[] }).data.length
    const res = await postJson('/api/v1/ticket-types', { name: 'Bad one', description: '  ', prefix: 'B', icon: 'i-lucide-skull', color: '#000000', fields: [] }, { cookie: admin.cookie })
    const body = await res.json() as ErrorBody
    expect(res.status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.map(d => d.key).sort()).toEqual(['color', 'description', 'icon', 'prefix'])
    await expectProblem((await createType(admin, { team_id: 9999 })).res, 422, 'team_id', /No Team/)
    const after = (await (await call('/api/v1/admin/ticket-types', { headers: { cookie: admin.cookie } })).json() as { data: unknown[] }).data.length
    expect(after).toBe(before)
  })

  it('creates nothing when one Field is invalid', async () => {
    const admin = await signInAs('admin')
    const { res, prefix } = await createType(admin, { fields: [system, { label: 'Pick one', type: 'single_select', options: [] }] })
    await expectProblem(res, 422, 'fields.1.options', /at least one option/)
    const list = await (await call('/api/v1/admin/ticket-types', { headers: { cookie: admin.cookie } })).json() as { data: Detail[] }
    expect(list.data.some(t => t.prefix === prefix)).toBe(false)
  })
})

describe('Ticket Type editor: duplicates are refused', () => {
  it('refuses a duplicate name, with a link to Restore when an archived type has it', async () => {
    const admin = await signInAs('admin')
    const active = await created(admin)
    const same = await createType(admin, { name: active.name.toUpperCase() })
    await expectProblem(same.res, 422, 'name', /exists/)

    const archived = await created(admin)
    expect((await patch(admin, archived.id, { archived: true })).status).toBe(200)
    const again = await createType(admin, { name: archived.name })
    const body = await expectProblem(again.res, 422, 'name', /archived type has this name/)
    expect(body.error.details?.find(d => d.key === 'name')?.restore_type_id).toBe(archived.id)
  })

  it('refuses a duplicate prefix, also the prefix of an archived type', async () => {
    const admin = await signInAs('admin')
    const active = await created(admin)
    await expectProblem((await createType(admin, { prefix: active.prefix.toLowerCase() })).res, 422, 'prefix', /is used by/)
    await expectProblem((await createType(admin, { prefix: 'bug' })).res, 422, 'prefix', /BUG is used by Bug/)

    const archived = await created(admin)
    await patch(admin, archived.id, { archived: true })
    await expectProblem((await createType(admin, { prefix: archived.prefix })).res, 422, 'prefix', /archived.*reserved/)
    // A rename to a taken prefix is refused too.
    await expectProblem(await patch(admin, active.id, { prefix: archived.prefix }), 422, 'prefix', /reserved/)
  })

  it('refuses a duplicate Field Key and a key of a core attribute', async () => {
    const admin = await signInAs('admin')
    const dup = await createType(admin, { fields: [{ label: 'Branch', type: 'short_text' }, { label: 'branch', type: 'short_text' }] })
    await expectProblem(dup.res, 422, 'fields.1.key', /already used/)
    const core = await createType(admin, { fields: [{ label: 'Title', type: 'short_text' }] })
    await expectProblem(core.res, 422, 'fields.0.key', /reserved/)

    const type = await created(admin, { fields: [{ label: 'Branch', type: 'short_text' }] })
    const res = await patch(admin, type.id, { base_version: 1, fields: [...type.fields, { label: 'BRANCH!', type: 'date' }] })
    await expectProblem(res, 422, 'fields.1.key', /already used/)
  })
})

describe('Ticket Type editor: Schema Versions', () => {
  it('makes version 2 on a Field change, and an old ticket stays on version 1 and still validates against it', async () => {
    const admin = await signInAs('admin')
    const requester = await signInAs('requester')
    const type = await created(admin, { fields: [system] })
    const oldTicket = await (await createTicket(requester, type.id, { system_or_tool: 'Wiki' })).json() as { ref: string }

    const res = await patch(admin, type.id, { base_version: 1, fields: [...type.fields, { label: 'Needed until', type: 'date', required: true }] })
    expect(res.status).toBe(200)
    const v2 = await res.json() as Detail
    expect(v2.schema_version).toBe(2)
    expect(v2.fields.map(f => f.key)).toEqual(['system_or_tool', 'needed_until'])

    // New tickets must fill the new required Field.
    const refused = await createTicket(requester, type.id, { system_or_tool: 'VPN' })
    expect(refused.status).toBe(422)
    const fresh = await (await createTicket(requester, type.id, { system_or_tool: 'VPN', needed_until: '2026-12-31' })).json() as { schema_version: number }
    expect(fresh.schema_version).toBe(2)

    const old = await (await call(`/api/v1/tickets/${oldTicket.ref}`, { headers: { cookie: requester.cookie } })).json() as { schema_version: number, fields: Record<string, unknown>, schema_fields: { key: string }[] }
    expect(old.schema_version).toBe(1)
    expect(old.schema_fields.map(f => f.key)).toEqual(['system_or_tool'])

    // Both rows exist, and version 1 is unchanged.
    const rows = (await env.DB.prepare('SELECT version, fields FROM schema_version WHERE ticket_type_id = ? ORDER BY version').bind(type.id).all<{ version: number, fields: string }>()).results
    expect(rows.map(r => r.version)).toEqual([1, 2])
    const v1Fields = JSON.parse(rows[0]!.fields) as FieldDef[]
    expect(v1Fields.map(f => f.key)).toEqual(['system_or_tool'])
    expect(validateFields(v1Fields, old.fields).ok).toBe(true)
  })

  it('allows rename, help, make required, add and archive options, archive and restore a Field', async () => {
    const admin = await signInAs('admin')
    const type = await created(admin, { fields: [system, until] })
    const edit = async (version: number, fields: unknown[]) => {
      const res = await patch(admin, type.id, { base_version: version, fields })
      expect(res.status, await res.clone().text()).toBe(200)
      return await res.json() as Detail
    }

    const v2 = await edit(1, [
      { ...type.fields[0], label: 'System', help: 'Which one?', options: [{ value: 'Wiki' }, { value: 'VPN', archived: true }, { value: 'Git' }] },
      { ...type.fields[1], required: true },
    ])
    expect(v2.schema_version).toBe(2)
    expect(v2.fields[0]).toMatchObject({ key: 'system_or_tool', label: 'System', help: 'Which one?', options: [{ value: 'Wiki' }, { value: 'VPN', archived: true }, { value: 'Git' }] })
    expect(v2.fields[1]).toMatchObject({ key: 'needed_until', required: true })

    const v3 = await edit(2, [v2.fields[0], { ...v2.fields[1], archived: true }])
    expect(v3).toMatchObject({ schema_version: 3, field_count: 1 })
    const shown = await (await call(`/api/v1/ticket-types/${type.id}`, { headers: { cookie: admin.cookie } })).json() as { fields: { key: string, options?: string[] }[] }
    expect(shown.fields.map(f => f.key)).toEqual(['system_or_tool'])
    expect(shown.fields[0]!.options).toEqual(['Wiki', 'Git'])

    const v4 = await edit(3, [v3.fields[0], { ...v3.fields[1], archived: false }])
    expect(v4).toMatchObject({ schema_version: 4, field_count: 2 })
  })

  it('makes no new version when the Fields do not change', async () => {
    const admin = await signInAs('admin')
    const type = await created(admin, { fields: [system] })
    const res = await patch(admin, type.id, { base_version: 1, fields: type.fields })
    expect(res.status).toBe(200)
    expect((await res.json() as Detail).schema_version).toBe(1)
    const same = await patch(admin, type.id, { name: type.name })
    expect(same.status).toBe(200)
  })

  it('refuses to change a data type, with a clear error, and saves nothing', async () => {
    const admin = await signInAs('admin')
    const type = await created(admin, { fields: [system, until] })
    const res = await patch(admin, type.id, { base_version: 1, fields: [{ ...type.fields[0], type: 'short_text', options: undefined }, type.fields[1]] })
    await expectProblem(res, 422, 'fields.0.type', /data type of “System or tool” \(system_or_tool\) cannot change from single_select/)
    expect((await detailOf(admin, type.id)).schema_version).toBe(1)
  })

  it('refuses to delete a Field or an option, and tells the Admin to archive', async () => {
    const admin = await signInAs('admin')
    const type = await created(admin, { fields: [system, until] })
    const gone = await patch(admin, type.id, { base_version: 1, fields: [type.fields[0]] })
    await expectProblem(gone, 422, 'fields', /cannot be deleted.*Archive it instead/)
    const noOption = await patch(admin, type.id, { base_version: 1, fields: [{ ...type.fields[0], options: [{ value: 'Wiki' }] }, type.fields[1]] })
    await expectProblem(noOption, 422, 'fields.0.options', /“VPN” .* cannot be removed.*Archive it instead/)
    expect((await detailOf(admin, type.id)).schema_version).toBe(1)
    // The API has no route that deletes a type: the request reaches no handler.
    const del = await call(`/api/v1/ticket-types/${type.id}`, { method: 'DELETE', headers: { cookie: admin.cookie } })
    expect(del.headers.get('content-type')).not.toContain('application/json')
    expect((await detailOf(admin, type.id)).field_count).toBe(2)
  })

  it('refuses a save from an older version with 409, and a save of Fields without a version', async () => {
    const admin = await signInAs('admin')
    const type = await created(admin, { fields: [system] })
    expect((await patch(admin, type.id, { base_version: 1, fields: [...type.fields, { label: 'One', type: 'short_text' }] })).status).toBe(200)
    const stale = await patch(admin, type.id, { base_version: 1, fields: [...type.fields, { label: 'Two', type: 'short_text' }] })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: { code: 'CONFLICT', message: expect.stringContaining('now version 2') } })
    await expectProblem(await patch(admin, type.id, { fields: type.fields }), 422, 'base_version', /version/)
    expect((await detailOf(admin, type.id)).field_count).toBe(2)
  })

  it('changes settings without a new version, and the prefix change keeps old references working', async () => {
    const admin = await signInAs('admin')
    const requester = await signInAs('requester')
    const type = await created(admin, { fields: [] })
    const ticket = await (await createTicket(requester, type.id)).json() as { number: number, ref: string }
    const next = fresh().prefix
    const res = await patch(admin, type.id, { prefix: next, name: `${type.name} v2`, description: 'New text.', color: '#1F5FD6', icon: 'i-lucide-key-round', visibility: 'internal' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ prefix: next, name: `${type.name} v2`, description: 'New text.', color: '#1F5FD6', icon: 'i-lucide-key-round', visibility: 'internal', schema_version: 1 })
    const read = await call(`/api/v1/tickets/${ticket.ref}`, { headers: { cookie: requester.cookie } })
    expect(await read.json()).toMatchObject({ number: ticket.number, ref: `${next}-${ticket.number}` })
  })

  it('answers 404 for an unknown type and 422 for an empty or unknown change', async () => {
    const admin = await signInAs('admin')
    expect((await patch(admin, 99999, { name: 'x' })).status).toBe(404)
    expect((await patch(admin, 0, { name: 'x' })).status).toBe(404)
    const type = await created(admin)
    await expectProblem(await patch(admin, type.id, {}), 422, 'body', /at least one/)
    expect((await patch(admin, type.id, { fields_json: [] })).status).toBe(422)
  })
})

describe('Ticket Type editor: archive', () => {
  it('refuses a new ticket of an archived type, keeps old tickets, and Restore allows new ones again', async () => {
    const admin = await signInAs('admin')
    const requester = await signInAs('requester')
    const type = await created(admin, { fields: [] })
    const old = await (await createTicket(requester, type.id)).json() as { ref: string }

    const archived = await patch(admin, type.id, { archived: true })
    expect(archived.status).toBe(200)
    expect((await archived.json() as Detail).archived_at).toEqual(expect.any(String))

    const refused = await createTicket(requester, type.id)
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ error: { details: [{ key: 'ticket_type_id', reason: expect.stringMatching(/archived/) }] } })

    // Readers do not see it. The old ticket still shows with its type.
    const listed = await (await call('/api/v1/ticket-types', { headers: { cookie: requester.cookie } })).json() as { data: { id: number }[] }
    expect(listed.data.some(t => t.id === type.id)).toBe(false)
    expect((await call(`/api/v1/ticket-types/${type.id}`, { headers: { cookie: requester.cookie } })).status).toBe(404)
    const kept = await call(`/api/v1/tickets/${old.ref}`, { headers: { cookie: requester.cookie } })
    expect(await kept.json()).toMatchObject({ ref: old.ref, ticket_type: { id: type.id } })

    // The Admin list shows it as archived.
    const adminList = await (await call('/api/v1/admin/ticket-types', { headers: { cookie: admin.cookie } })).json() as { data: Detail[] }
    expect(adminList.data.find(t => t.id === type.id)).toMatchObject({ archived_at: expect.any(String), ticket_count: 1 })

    expect((await patch(admin, type.id, { archived: false })).status).toBe(200)
    expect((await createTicket(requester, type.id)).status).toBe(201)
  })
})

describe('Ticket Type editor: Admin list', () => {
  it('lists prefix, Field count, open tickets, Team, visibility, version, and the Teams', async () => {
    const admin = await signInAs('admin')
    const requester = await signInAs('requester')
    const type = await created(admin, { fields: [system, until], visibility: 'internal' })
    const a = await (await createTicket(requester, type.id, { system_or_tool: 'Wiki' })).json() as { number: number }
    await createTicket(requester, type.id, { system_or_tool: 'Wiki' })
    // A ticket in a done Status is not open.
    await env.DB.prepare("UPDATE ticket SET status = 'closed' WHERE number = ?").bind(a.number).run()

    const res = await call('/api/v1/admin/ticket-types', { headers: { cookie: admin.cookie } })
    const body = await res.json() as { data: Detail[], teams: { id: number, name: string }[] }
    expect(body.teams).toEqual(expect.arrayContaining([{ id: expect.any(Number), name: 'Support' }]))
    expect(body.data.find(t => t.id === type.id)).toMatchObject({
      prefix: type.prefix, field_count: 2, open_tickets: 1, ticket_count: 2, team: { name: 'Support' }, visibility: 'internal', schema_version: 1, archived_at: null,
    })
    expect(body.data.find(t => t.prefix === 'BUG')).toMatchObject({ field_count: 3, schema_version: 1 })
  })
})

describe('Ticket Type editor: MCP', () => {
  it('get_ticket_type returns the newest version after an edit, and list_ticket_types leaves out an archived type', async () => {
    const admin = await signInAs('admin')
    const type = await created(admin, { fields: [system] })
    const { access_token } = await getMcpToken(admin.cookie)
    const client = await connectMcp(access_token)

    const first = await client.callTool({ name: 'get_ticket_type', arguments: { ticket_type_id: type.id } })
    expect(first.structuredContent).toMatchObject({ schema_version: 1 })

    expect((await patch(admin, type.id, { base_version: 1, fields: [...type.fields, { label: 'Needed until', type: 'date', help: 'A date.' }] })).status).toBe(200)
    const second = await client.callTool({ name: 'get_ticket_type', arguments: { ticket_type_id: type.id } })
    const out = second.structuredContent as { schema_version: number, fields_schema: { properties: Record<string, { description: string }> } }
    expect(out.schema_version).toBe(2)
    expect(Object.keys(out.fields_schema.properties)).toEqual(['system_or_tool', 'needed_until'])
    expect(out.fields_schema.properties.needed_until!.description).toBe('A date.')

    await patch(admin, type.id, { archived: true })
    const listed = await client.callTool({ name: 'list_ticket_types', arguments: {} })
    expect((listed.structuredContent as { ticket_types: { id: number }[] }).ticket_types.some(t => t.id === type.id)).toBe(false)
    const gone = await client.callTool({ name: 'get_ticket_type', arguments: { ticket_type_id: type.id } })
    expect(gone.isError).toBe(true)
    const create = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: type.id, title: 'x' } })
    expect(create.isError).toBe(true)
    expect(JSON.stringify(create.content)).toContain('archived')
    await client.close()
  })

  it('writes an audit entry with Principal and channel for each change, in the same write', async () => {
    const admin = await signInAs('admin')
    const type = await created(admin, { fields: [system] })
    const entry = (a: Awaited<ReturnType<typeof adminAuditOf>>, action: string) => a.filter(e => e.action === action)

    expect((await patch(admin, type.id, { name: `${type.name} 2`, base_version: 1, fields: [...type.fields, { label: 'Needed until', type: 'date' }] })).status).toBe(200)
    expect((await patch(admin, type.id, { archived: true })).status).toBe(200)
    expect((await patch(admin, type.id, { archived: false })).status).toBe(200)
    // A refused change writes nothing.
    expect((await patch(admin, type.id, { base_version: 1, fields: [] })).status).toBeGreaterThanOrEqual(400)

    const log = await adminAuditOf('ticket_type', type.id)
    expect(log.map(e => e.action)).toEqual(['type_created', 'type_settings_changed', 'schema_version_created', 'type_archived', 'type_restored'])
    for (const e of log) expect(e).toMatchObject({ principal_id: admin.user.id, channel: 'web' })
    expect(entry(log, 'type_created')[0]!.after).toMatchObject({ name: type.name, prefix: type.prefix, team_id: type.team.id })
    expect(entry(log, 'type_settings_changed')[0]).toMatchObject({ before: { name: type.name }, after: { name: `${type.name} 2` } })
    expect(entry(log, 'schema_version_created')[0]).toMatchObject({ before: { version: 1 }, after: { version: 2, added: ['needed_until'] } })
  })
})
