import { describe, expect, it } from 'vitest'
import { call, postJson, signIn, uniqueEmail } from './helpers'

describe('tickets REST API', () => {
  it('needs a session', async () => {
    const res = await call('/api/v1/tickets')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Sign in first.', details: null } })
  })

  it('creates a ticket with a Ticket Reference and finds it by reference or number', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const res = await postJson('/api/v1/tickets', { title: 'Report is empty', description: 'Since Monday.' }, { cookie })
    expect(res.status).toBe(201)
    const created = await res.json() as { number: number, ref: string, channel: string }
    expect(created.ref).toBe(`BUG-${created.number}`)
    expect(created.channel).toBe('web')

    for (const ref of [created.ref, String(created.number), `bug-${created.number}`, `OLD-${created.number}`]) {
      expect((await call(`/api/v1/tickets/${ref}`, { headers: { cookie } })).status, ref).toBe(200)
    }
  })

  it('gives ticket numbers from one counter', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const a = await (await postJson('/api/v1/tickets', { title: 'A' }, { cookie })).json() as { number: number }
    const b = await (await postJson('/api/v1/tickets', { title: 'B' }, { cookie })).json() as { number: number }
    expect(b.number).toBeGreaterThan(a.number)
  })

  it('names each invalid field', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const res = await postJson('/api/v1/tickets', { title: '' }, { cookie })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', details: [{ field: 'title', reason: 'Title is required.' }] } })
  })

  it('does not show a Requester the tickets of another Requester', async () => {
    const owner = await signIn(uniqueEmail())
    const other = await signIn(uniqueEmail())
    const { ref } = await (await postJson('/api/v1/tickets', { title: 'Private' }, { cookie: owner.cookie })).json() as { ref: string }

    expect((await call(`/api/v1/tickets/${ref}`, { headers: { cookie: other.cookie } })).status).toBe(404)
    const list = await (await call('/api/v1/tickets', { headers: { cookie: other.cookie } })).json() as { data: { ref: string }[] }
    expect(list.data.map(t => t.ref)).not.toContain(ref)
  })
})
