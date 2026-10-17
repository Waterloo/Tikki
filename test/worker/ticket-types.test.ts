import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, signIn, uniqueEmail } from './helpers'

interface TypeView { id: number, name: string, prefix: string, description: string, icon: string, color: string, team: { name: string }, visible_to_all: boolean }

describe('Ticket Types REST API', () => {
  it('needs a session', async () => {
    expect((await call('/api/v1/ticket-types')).status).toBe(401)
    expect((await call('/api/v1/ticket-types/1')).status).toBe(401)
  })

  it('lists the three seeded types, owned by the Support Team', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const res = await call('/api/v1/ticket-types', { headers: { cookie } })
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: TypeView[] }
    expect(data.map(t => [t.name, t.prefix, t.team.name])).toEqual([
      ['Bug', 'BUG', 'Support'],
      ['Data request', 'DATA', 'Support'],
      ['General request', 'GEN', 'Support'],
    ])
    for (const t of data) {
      expect(t.description).not.toBe('')
      expect(t.icon).toMatch(/^i-lucide-/)
      expect(t.color).toMatch(/^#[0-9A-F]{6}$/)
      expect(t.visible_to_all).toBe(false)
    }
  })

  it('seeds once: applying the migrations again adds no type, Team, or Schema Version', async () => {
    const count = async () => (await env.DB.prepare(
      'SELECT (SELECT count(*) FROM ticket_type) AS types, (SELECT count(*) FROM team) AS teams, (SELECT count(*) FROM schema_version) AS versions',
    ).first())
    expect(await count()).toEqual({ types: 3, teams: 1, versions: 3 })
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
    expect(await count()).toEqual({ types: 3, teams: 1, versions: 3 })
  })

  it('gets a type with the Fields of its current Schema Version', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const { data } = await (await call('/api/v1/ticket-types', { headers: { cookie } })).json() as { data: TypeView[] }
    for (const t of data) {
      const res = await call(`/api/v1/ticket-types/${t.id}`, { headers: { cookie } })
      expect(res.status).toBe(200)
      const body = await res.json() as TypeView & { schema_version: number, fields: unknown[] }
      expect(body).toMatchObject({ ...t, schema_version: 1 })
      expect(body.fields.length).toBeGreaterThanOrEqual(2)
      expect(body.fields.length).toBeLessThanOrEqual(3)
    }

    const bug = data.find(t => t.prefix === 'BUG')!
    const { fields } = await (await call(`/api/v1/ticket-types/${bug.id}`, { headers: { cookie } })).json() as { fields: unknown[] }
    expect(fields).toEqual([
      { key: 'page_or_feature', label: 'Page or feature', type: 'short_text', required: true, help: expect.any(String) },
      { key: 'steps_to_reproduce', label: 'Steps to reproduce', type: 'long_text', required: false, help: expect.any(String) },
      { key: 'frequency', label: 'How often does it happen?', type: 'single_select', required: false, help: expect.any(String), options: ['Every time', 'Sometimes', 'Once'] },
    ])
  })

  it('answers 404 for an unknown type', async () => {
    const { cookie } = await signIn(uniqueEmail())
    for (const id of ['999', 'abc', '0']) {
      const res = await call(`/api/v1/ticket-types/${id}`, { headers: { cookie } })
      expect(res.status, id).toBe(404)
      expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }
  })
})
