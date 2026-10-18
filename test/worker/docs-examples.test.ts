import { beforeAll, describe, expect, it } from 'vitest'
import { call, postJson, signInAs, typeId } from './helpers'

// The error examples of the OpenAPI document are shown in the docs at /docs/api. Each one must be what the API answers.

interface ErrorBody { error: { code: string, message: string, details: unknown } }
interface Doc { paths: Record<string, Record<string, { responses: Record<string, { content?: { 'application/json'?: { example?: ErrorBody } } }> }>> }

let doc: Doc
let admin: Awaited<ReturnType<typeof signInAs>>
let gen: number

const example = (path: string, method: string, status: number) => {
  const e = doc.paths[path]![method]!.responses[status]!.content!['application/json']!.example
  if (!e) throw new Error(`No example for ${method.toUpperCase()} ${path} ${status}.`)
  return e
}

async function newApp() {
  const res = await postJson('/api/v1/applications', { name: `Docs ${Date.now()} ${Math.random()}`, description: 'Docs examples.', permissions: ['tickets:create', 'tickets:read'], ticket_type_ids: [gen] }, { cookie: admin.cookie })
  const app = await res.json() as { id: number }
  const key = await (await postJson(`/api/v1/applications/${app.id}/keys`, { name: 'Test' }, { cookie: admin.cookie })).json() as { key: string }
  return { id: app.id, auth: { authorization: `Bearer ${key.key}` } }
}
const patchApp = (id: number, body: unknown) => call(`/api/v1/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { cookie: admin.cookie } })

beforeAll(async () => {
  doc = await (await call('/api/v1/openapi.json')).json() as Doc
  admin = await signInAs('admin')
  gen = await typeId(admin.cookie, 'GEN')
})

describe('the error examples in the OpenAPI document', () => {
  it('401 for a wrong API key', async () => {
    const res = await call('/api/v1/tickets', { headers: { authorization: 'Bearer gt_live_wrong' } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual(example('/api/v1/tickets', 'get', 401))
  })

  it('404 for a ticket of another source', async () => {
    const { auth } = await newApp()
    const res = await call('/api/v1/tickets/999999', { headers: auth })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(example('/api/v1/tickets/{ref}', 'get', 404))
  })

  it('409 for an Idempotency-Key with another body, and 422 with its shape', async () => {
    const { auth } = await newApp()
    const contact = { external_id: 'docs-1', name: 'Jo Park', email: 'jo@example.org' }
    const headers = { ...auth, 'idempotency-key': `docs-${Date.now()}` }
    expect((await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'One', contact }, headers)).status).toBe(201)
    const reused = await postJson('/api/v1/tickets', { ticket_type_id: gen, title: 'Two', contact }, headers)
    expect(reused.status).toBe(409)
    expect(await reused.json()).toEqual(example('/api/v1/tickets', 'post', 409))

    const invalid = await postJson('/api/v1/tickets', { ticket_type_id: gen, contact }, auth)
    expect(invalid.status).toBe(422)
    const body = await invalid.json() as ErrorBody
    const want = example('/api/v1/tickets', 'post', 422)
    expect({ code: body.error.code, message: body.error.message }).toEqual({ code: want.error.code, message: want.error.message })
    expect(Object.keys((body.error.details as object[])[0]!).sort()).toEqual(Object.keys((want.error.details as object[])[0]!).sort())
  })

  it('403 for a disabled Application', async () => {
    const { id, auth } = await newApp()
    await patchApp(id, { enabled: false })
    const res = await call('/api/v1/ticket-types', { headers: auth })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(example('/api/v1/ticket-types', 'get', 403))
  })

  it('429 over the limit, with Retry-After', async () => {
    const { id, auth } = await newApp()
    await patchApp(id, { rate_limit: 1, create_limit: 1 })
    await call('/api/v1/ticket-types', { headers: auth })
    const res = await call('/api/v1/ticket-types', { headers: auth })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    const body = await res.json() as ErrorBody
    const want = example('/api/v1/ticket-types', 'get', 429)
    const seconds = (m: string) => m.replace(/\d+ seconds?/, 'N seconds')
    expect({ ...body.error, message: seconds(body.error.message) }).toEqual({ ...want.error, message: seconds(want.error.message) })
  })
})
