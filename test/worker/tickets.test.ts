import { describe, expect, it } from 'vitest'
import { call, postJson, signIn, typeId, uniqueEmail } from './helpers'

interface Created { number: number, ref: string, channel: string }

async function signedIn() {
  const session = await signIn(uniqueEmail())
  const [bug, data, gen] = await Promise.all(['BUG', 'DATA', 'GEN'].map(p => typeId(session.cookie, p)))
  return { ...session, bug: bug!, data: data!, gen: gen! }
}

describe('tickets REST API', () => {
  it('needs a session', async () => {
    const res = await call('/api/v1/tickets')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Sign in first.', details: null } })
  })

  it('creates a ticket with Field values, returns the Ticket Reference, and reads the values back', async () => {
    const { cookie, user, bug } = await signedIn()
    const res = await postJson('/api/v1/tickets', {
      ticket_type_id: bug,
      title: 'Export fails',
      description: 'Since Monday.',
      priority: 'high',
      fields: { page_or_feature: '  Reports ', frequency: 'Every time', steps_to_reproduce: '' },
    }, { cookie })
    expect(res.status).toBe(201)
    const created = await res.json() as Created
    expect(created.ref).toBe(`BUG-${created.number}`)

    const read = await call(`/api/v1/tickets/${created.ref}`, { headers: { cookie } })
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({
      number: created.number,
      ref: created.ref,
      title: 'Export fails',
      description: 'Since Monday.',
      priority: 'high',
      status: { key: 'open', name: 'Open', category: 'open' },
      ticket_type: { id: bug, name: 'Bug', prefix: 'BUG', icon: 'i-lucide-bug', color: '#C2362F' },
      team: { id: expect.any(Number), name: 'Support' },
      schema_version: 1,
      fields: { page_or_feature: 'Reports', frequency: 'Every time' },
      schema_fields: [
        { key: 'page_or_feature', label: 'Page or feature', type: 'short_text', required: true, help: expect.any(String) },
        { key: 'steps_to_reproduce', label: 'Steps to reproduce', type: 'long_text', required: false, help: expect.any(String) },
        { key: 'frequency', label: 'How often does it happen?', type: 'single_select', required: false, help: expect.any(String), options: ['Every time', 'Sometimes', 'Once'] },
      ],
      requester: { id: user.id, name: expect.any(String), email: user.email },
      assignee: null,
      comment_count: 0,
      reopened_from: null,
      allowed_actions: ['edit_fields', 'edit_description', 'comment', 'cancel'],
      channel: 'web',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    })
  })

  it('gives Priority normal when it is not set', async () => {
    const { cookie, gen } = await signedIn()
    const created = await (await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'New laptop' }, { cookie })).json() as Created & { priority: string }
    expect(created.priority).toBe('normal')
  })

  it('finds a ticket by reference, by number, and by an old prefix', async () => {
    const { cookie, gen } = await signedIn()
    const created = await (await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'A' }, { cookie })).json() as Created
    for (const ref of [created.ref, String(created.number), `gen-${created.number}`, `OLD-${created.number}`]) {
      expect((await call(`/api/v1/tickets/${ref}`, { headers: { cookie } })).status, ref).toBe(200)
    }
  })

  it('gives consecutive numbers from one counter, with the prefix of each type', async () => {
    const { cookie, bug, data } = await signedIn()
    const a = await (await postJson('/api/v1/tickets', { ticket_type_id: bug, title: 'A', fields: { page_or_feature: 'Login' } }, { cookie })).json() as Created
    const b = await (await postJson('/api/v1/tickets', { ticket_type_id: data, title: 'B', fields: { dataset: 'Churn' } }, { cookie })).json() as Created
    expect(b.number).toBe(a.number + 1)
    expect(a.ref).toBe(`BUG-${a.number}`)
    expect(b.ref).toBe(`DATA-${b.number}`)
  })

  it('returns 422 with one entry for each Field problem', async () => {
    const { cookie, bug, data } = await signedIn()
    const res = await postJson('/api/v1/tickets', {
      ticket_type_id: bug,
      title: 'Export fails',
      fields: { frequency: 'Daily', page: 'Reports' },
    }, { cookie })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request has invalid values.',
        details: [
          { key: 'page', label: 'page', reason: 'This Ticket Type has no Field with this key. Known keys: page_or_feature, steps_to_reproduce, frequency.' },
          { key: 'page_or_feature', label: 'Page or feature', reason: 'Required.' },
          { key: 'frequency', label: 'How often does it happen?', reason: 'Must be one of the options.', options: ['Every time', 'Sometimes', 'Once'] },
        ],
      },
    })

    const date = await postJson('/api/v1/tickets', { ticket_type_id: data, title: 'X', fields: { dataset: 'Churn', needed_by: 'next week' } }, { cookie })
    expect((await date.json() as { error: { details: unknown } }).error.details).toEqual([
      { key: 'needed_by', label: 'Needed by', reason: 'Must be a date in the format YYYY-MM-DD.' },
    ])
  })

  it('reports core attribute problems and Field problems together', async () => {
    const { cookie, bug } = await signedIn()
    const res = await postJson('/api/v1/tickets', { ticket_type_id: bug, title: '', priority: 'asap' }, { cookie })
    expect(res.status).toBe(422)
    expect((await res.json() as { error: { details: unknown } }).error.details).toEqual([
      { key: 'title', label: 'Title', reason: 'Title is required.' },
      { key: 'priority', label: 'Priority', reason: 'Must be one of the options.', options: ['low', 'normal', 'high', 'urgent'] },
      { key: 'page_or_feature', label: 'Page or feature', reason: 'Required.' },
    ])
  })

  it('needs an existing Ticket Type', async () => {
    const { cookie } = await signedIn()
    for (const [body, reason] of [[{ title: 'A' }, 'Choose a Ticket Type.'], [{ title: 'A', ticket_type_id: 999 }, 'No Ticket Type has this ID.']] as const) {
      const res = await postJson('/api/v1/tickets', body, { cookie })
      expect(res.status).toBe(422)
      expect((await res.json() as { error: { details: unknown } }).error.details).toEqual([{ key: 'ticket_type_id', label: 'Ticket Type', reason }])
    }
  })

  it('does not show a Requester the tickets of another Requester', async () => {
    const owner = await signedIn()
    const other = await signIn(uniqueEmail())
    const { ref } = await (await postJson('/api/v1/tickets', { ticket_type_id: owner.gen, title: 'Private' }, { cookie: owner.cookie })).json() as Created

    const read = await call(`/api/v1/tickets/${ref}`, { headers: { cookie: other.cookie } })
    expect(read.status).toBe(404)
    expect(await read.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No ticket with this reference.', details: null } })
    const list = await (await call('/api/v1/tickets', { headers: { cookie: other.cookie } })).json() as { data: { ref: string }[] }
    expect(list.data.map(t => t.ref)).not.toContain(ref)
  })
})
