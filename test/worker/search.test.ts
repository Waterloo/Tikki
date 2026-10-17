import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, postJson, signInAs, typeId } from './helpers'

interface Row { number: number, ref: string, status: { key: string } }
interface Page { data: Row[], counts: Record<string, number>, next_cursor: string | null }

const token = () => `zq${Math.random().toString(36).slice(2, 10)}`

async function list(cookie: string, query: Record<string, string | string[]>): Promise<{ res: Response, body: Page }> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) for (const item of [v].flat()) params.append(k, item)
  const res = await call(`/api/v1/tickets?${params}`, { headers: { cookie } })
  return { res, body: await res.json() as Page }
}

async function create(cookie: string, body: Record<string, unknown>) {
  const res = await postJson('/api/v1/tickets', body, { cookie })
  expect(res.status, await res.clone().text()).toBe(201)
  return await res.json() as Row
}

const numbers = (page: Page) => page.data.map(r => r.number).sort((a, b) => a - b)

/** A visible type with a Branch Field in Schema Version 1; version 2 adds a Field. Tickets are made through the API. */
async function branchType() {
  const prefix = `B${Array.from(crypto.getRandomValues(new Uint8Array(4)), b => String.fromCharCode(65 + (b % 26))).join('')}`
  const type = await env.DB.prepare(
    `INSERT INTO ticket_type (name, prefix, description, team_id, visible_to_all, created_at)
     VALUES (?, ?, 'Branch notices.', (SELECT id FROM team WHERE name = 'Support'), 1, ?) RETURNING id`,
  ).bind(`Branch ${prefix}`, prefix, Date.now()).first<{ id: number }>()
  const branch = { key: 'branch', label: 'Branch', type: 'single_select', required: false, help: '', options: [{ value: 'Singapore' }, { value: 'Australia' }] }
  const tags = { key: 'tags', label: 'Tags', type: 'multi_select', required: false, help: '', options: [{ value: 'red' }, { value: 'blue' }] }
  await env.DB.prepare('INSERT INTO schema_version (ticket_type_id, version, fields, created_at) VALUES (?, 1, ?, ?)')
    .bind(type!.id, JSON.stringify([branch, tags]), Date.now()).run()
  return type!.id
}

async function addVersion2(typeId: number) {
  const fields = [
    { key: 'branch', label: 'Office branch', type: 'single_select', required: false, help: '', options: [{ value: 'Singapore' }, { value: 'Australia' }] },
    { key: 'tags', label: 'Tags', type: 'multi_select', required: false, help: '', options: [{ value: 'red' }, { value: 'blue' }] },
  ]
  await env.DB.prepare('INSERT INTO schema_version (ticket_type_id, version, fields, created_at) VALUES (?, 2, ?, ?)')
    .bind(typeId, JSON.stringify(fields), Date.now()).run()
}

describe('search and filters', () => {
  it('finds a ticket by a word in the title, a word in the description, and its reference with any prefix', async () => {
    const { cookie } = await signInAs('agent')
    const gen = await typeId(cookie, 'GEN')
    const inTitle = token()
    const inDescription = token()
    const a = await create(cookie, { ticket_type_id: gen, title: `Printer ${inTitle} jams` })
    const b = await create(cookie, { ticket_type_id: gen, title: 'Other', description: `It says ${inDescription} on screen.` })

    expect(numbers((await list(cookie, { q: inTitle })).body)).toEqual([a.number])
    expect(numbers((await list(cookie, { q: inDescription })).body)).toEqual([b.number])
    expect(numbers((await list(cookie, { q: inTitle.toUpperCase() })).body)).toEqual([a.number])
    for (const q of [a.ref, `OLD-${a.number}`, `bug-${a.number}`, String(a.number)]) {
      expect((await list(cookie, { q })).body.data.map(r => r.number), q).toContain(a.number)
    }
    // Every word must match.
    expect((await list(cookie, { q: `${inTitle} ${inDescription}` })).body.data).toEqual([])
  })

  it('treats % and _ in the search as text', async () => {
    const { cookie } = await signInAs('agent')
    const gen = await typeId(cookie, 'GEN')
    const word = token()
    const plain = await create(cookie, { ticket_type_id: gen, title: `${word} 100x done` })
    const percent = await create(cookie, { ticket_type_id: gen, title: `${word} 100% done` })
    const underscore = await create(cookie, { ticket_type_id: gen, title: `${word} a_b` })
    await create(cookie, { ticket_type_id: gen, title: `${word} axb` })
    expect(numbers((await list(cookie, { q: `${word} 100%` })).body)).toEqual([percent.number])
    expect(numbers((await list(cookie, { q: `${word} a_b` })).body)).toEqual([underscore.number])
    expect(numbers((await list(cookie, { q: `${word} %` })).body)).toEqual([percent.number])
    expect(plain.number).toBeLessThan(percent.number)
  })

  it('filters by a Field Key across Schema Versions', async () => {
    const { cookie } = await signInAs('agent')
    const type = await branchType()
    const v1 = await create(cookie, { ticket_type_id: type, title: 'On version one', fields: { branch: 'Singapore', tags: ['red'] } })
    await create(cookie, { ticket_type_id: type, title: 'Elsewhere', fields: { branch: 'Australia' } })
    await addVersion2(type)
    const v2 = await create(cookie, { ticket_type_id: type, title: 'On version two', fields: { branch: 'Singapore', tags: ['blue'] } })
    const detail = await (await call(`/api/v1/tickets/${v2.ref}`, { headers: { cookie } })).json() as { schema_version: number }
    expect(detail.schema_version).toBe(2)

    expect(numbers((await list(cookie, { type: String(type), field: 'branch:Singapore' })).body)).toEqual([v1.number, v2.number])
    // A multi-select matches one of its items.
    expect(numbers((await list(cookie, { type: String(type), field: ['branch:Singapore', 'tags:blue'] })).body)).toEqual([v2.number])
    expect((await list(cookie, { type: String(type), field: 'branch:Mars' })).body.data).toEqual([])
    // The quote in the value is a bound value, not SQL.
    expect((await list(cookie, { field: `branch:" OR 1=1 --` })).body.data).toEqual([])
  })

  it('filters by Ticket Type, Priority, and assignee, and keeps the counts to the filter', async () => {
    const { cookie, user } = await signInAs('agent')
    const gen = await typeId(cookie, 'GEN')
    const word = token()
    const urgent = await create(cookie, { ticket_type_id: gen, title: `${word} a`, priority: 'urgent' })
    await create(cookie, { ticket_type_id: gen, title: `${word} b`, priority: 'low' })
    await postJson('/api/v1/tickets', {}, { cookie })
    const patch = await call(`/api/v1/tickets/${urgent.ref}`, { method: 'PATCH', body: JSON.stringify({ assignee_id: user.id, status: 'in_progress' }), headers: { cookie } })
    expect(patch.status).toBe(200)

    const priority = await list(cookie, { q: word, priority: 'urgent' })
    expect(numbers(priority.body)).toEqual([urgent.number])
    expect(priority.body.counts).toEqual({ in_progress: 1 })
    expect(numbers((await list(cookie, { q: word, type: String(gen), assignee: user.id })).body)).toEqual([urgent.number])
    expect(numbers((await list(cookie, { q: word, assignee: 'me' })).body)).toEqual([urgent.number])
    expect((await list(cookie, { q: word, type: '999999' })).body.data).toEqual([])
    expect((await list(cookie, { q: word, open: 'true' })).body.data).toHaveLength(2)
  })

  it('refuses bad filter values with the Field Key and reason', async () => {
    const { cookie } = await signInAs('agent')
    for (const query of [{ priority: 'huge' }, { type: 'abc' }, { field: 'nocolon' }, { limit: '0' }, { limit: '9999' }, { cursor: 'not-a-cursor' }]) {
      const { res, body } = await list(cookie, query)
      expect(res.status, JSON.stringify(query)).toBe(422)
      expect((body as unknown as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('never returns tickets that the Requester cannot read, whatever the search or filter', async () => {
    const agent = await signInAs('agent')
    const requester = await signInAs('requester')
    const other = await signInAs('requester')
    const word = token()
    const bug = await typeId(agent.cookie, 'BUG')
    const type = await branchType()
    const secret = await create(other.cookie, { ticket_type_id: bug, title: `${word} secret`, fields: { page_or_feature: 'Login' } })
    const mine = await create(requester.cookie, { ticket_type_id: bug, title: `${word} mine`, fields: { page_or_feature: 'Login' } })
    const shared = await create(agent.cookie, { ticket_type_id: type, title: `${word} shared`, fields: { branch: 'Singapore' } })

    // The agent sees all three, so the Requester's result is cut by the read rule and not by the query.
    expect(numbers((await list(agent.cookie, { q: word })).body)).toEqual([secret.number, mine.number, shared.number])
    for (const query of [{ q: word }, { q: secret.ref }, { q: String(secret.number) }, { q: word, type: String(bug) }, { field: 'page_or_feature:Login' }, { q: word, assignee: 'none' }, { q: word, priority: 'normal' }]) {
      const { body } = await list(requester.cookie, query)
      expect(body.data.map(r => r.number), JSON.stringify(query)).not.toContain(secret.number)
    }
    expect(numbers((await list(requester.cookie, { q: word })).body)).toEqual([mine.number, shared.number])
    expect((await list(requester.cookie, { q: word })).body.counts).toEqual({ open: 2 })
  })
})

describe('cursor pagination', () => {
  it('returns every ticket once across pages, in Status order, with counts for all pages', async () => {
    const { cookie } = await signInAs('agent')
    const gen = await typeId(cookie, 'GEN')
    const word = token()
    const made: Row[] = []
    for (let i = 0; i < 7; i++) made.push(await create(cookie, { ticket_type_id: gen, title: `${word} ${i}` }))
    // Spread over two Statuses, and give two tickets the same update time.
    for (const t of made.slice(0, 3)) {
      expect((await call(`/api/v1/tickets/${t.ref}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }), headers: { cookie } })).status).toBe(200)
    }
    await env.DB.prepare('UPDATE ticket SET updated_at = (SELECT updated_at FROM ticket WHERE number = ?) WHERE number = ?').bind(made[5]!.number, made[4]!.number).run()

    const seen: number[] = []
    const statuses: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const { body } = await list(cookie, cursor ? { q: word, limit: '2', cursor } : { q: word, limit: '2' })
      expect(body.counts).toEqual({ open: 4, resolved: 3 })
      expect(body.data.length).toBeLessThanOrEqual(2)
      seen.push(...body.data.map(r => r.number))
      statuses.push(...body.data.map(r => r.status.key))
      cursor = body.next_cursor ?? undefined
      pages++
    } while (cursor)

    expect(pages).toBe(4)
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
    expect([...seen].sort((a, b) => a - b)).toEqual(made.map(m => m.number))
    expect(statuses).toEqual([...statuses].sort((a, b) => (a === 'open' ? -1 : 1) - (b === 'open' ? -1 : 1)))
    // The same order without paging.
    expect((await list(cookie, { q: word })).body.data.map(r => r.number)).toEqual(seen)
  })

  it('returns no cursor when everything fits in one page', async () => {
    const { cookie } = await signInAs('agent')
    const gen = await typeId(cookie, 'GEN')
    const word = token()
    await create(cookie, { ticket_type_id: gen, title: word })
    expect((await list(cookie, { q: word, limit: '1' })).body.next_cursor).toBeNull()
  })
})

describe('similar tickets', () => {
  async function similar(cookie: string, title: string) {
    const res = await call(`/api/v1/tickets/similar?${new URLSearchParams({ title })}`, { headers: { cookie } })
    expect(res.status).toBe(200)
    return (await res.json() as { data: Row[] }).data
  }

  it('finds open tickets with shared words, skips done ones, and caps the list', async () => {
    const { cookie } = await signInAs('agent')
    const gen = await typeId(cookie, 'GEN')
    const word = token()
    const open = await create(cookie, { ticket_type_id: gen, title: `Export ${word} crashes on reports` })
    const done = await create(cookie, { ticket_type_id: gen, title: `Export ${word} crashes on invoices` })
    await call(`/api/v1/tickets/${done.ref}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }), headers: { cookie } })
    for (let i = 0; i < 6; i++) await create(cookie, { ticket_type_id: gen, title: `Export ${word} crashes ${i}` })

    const found = await similar(cookie, `${word} export crashing`)
    expect(found.length).toBe(5)
    expect(found.map(r => r.number)).not.toContain(done.number)
    // One shared word only is not enough for a longer title.
    expect(await similar(cookie, `${word} unrelated phrase here`)).toEqual([])
    expect(await similar(cookie, 'ab')).toEqual([])
    expect(open.number).toBeGreaterThan(0)
  })

  it('shows a Requester only tickets that the Requester can read', async () => {
    const agent = await signInAs('agent')
    const requester = await signInAs('requester')
    const word = token()
    const bug = await typeId(agent.cookie, 'BUG')
    const type = await branchType()
    const hidden = await create(agent.cookie, { ticket_type_id: bug, title: `Hidden ${word} problem`, fields: { page_or_feature: 'Login' } })
    const visible = await create(agent.cookie, { ticket_type_id: type, title: `Visible ${word} problem` })
    expect((await similar(agent.cookie, `${word} problem`)).map(r => r.number).sort()).toEqual([hidden.number, visible.number].sort())
    expect((await similar(requester.cookie, `${word} problem`)).map(r => r.number)).toEqual([visible.number])
  })

  it('needs a session and a title', async () => {
    expect((await call('/api/v1/tickets/similar?title=abc')).status).toBe(401)
    const { cookie } = await signInAs('requester')
    expect((await call('/api/v1/tickets/similar', { headers: { cookie } })).status).toBe(422)
  })
})
