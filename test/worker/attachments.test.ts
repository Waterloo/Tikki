import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createVisibleType, postJson, signIn, signInAs, typeId, uniqueEmail } from './helpers'

const MAX = 25 * 1024 * 1024

interface Uploaded { id: string, filename: string, size: number, content_type: string, ticket_number: number | null, url: string }
interface ErrorBody { error: { code: string, message: string } }

function put(path: string, cookie: string, body: BodyInit | null, headers: Record<string, string> = {}) {
  return call(path, { method: 'PUT', body, headers: { cookie, 'x-filename': 'note.txt', 'content-type': 'text/plain', ...headers } })
}

function bytes(text: string) {
  return new TextEncoder().encode(text)
}

async function newTicket(cookie: string) {
  const res = await postJson('/api/v1/tickets', {
    ticket_type_id: await typeId(cookie, 'BUG'),
    title: 'Needs a file',
    fields: { page_or_feature: 'Reports' },
  }, { cookie })
  return await res.json() as { number: number, ref: string }
}

/** A new Ticket Type with a required-free "file" Field. The Admin type editor is issue 07, so the test writes the rows. */
async function createFileType(): Promise<number> {
  const prefix = `F${Array.from(crypto.getRandomValues(new Uint8Array(4)), b => String.fromCharCode(65 + (b % 26))).join('')}`
  const type = await env.DB.prepare(
    `INSERT INTO ticket_type (name, prefix, description, team_id, visible_to_all, created_at)
     VALUES (?, ?, 'Has a file.', (SELECT id FROM team WHERE name = 'Support'), 0, ?) RETURNING id`,
  ).bind(`Files ${prefix}`, prefix, Date.now()).first<{ id: number }>()
  await env.DB.prepare('INSERT INTO schema_version (ticket_type_id, version, fields, created_at) VALUES (?, 1, ?, ?)')
    .bind(type!.id, JSON.stringify([{ key: 'screenshot', label: 'Screenshot', type: 'file', required: false, help: '' }]), Date.now()).run()
  return type!.id
}

describe('attachments REST API', () => {
  it('needs a session', async () => {
    expect((await call('/api/v1/attachments', { method: 'PUT', body: bytes('x') })).status).toBe(401)
    expect((await call('/api/v1/tickets/BUG-1/attachments', { method: 'PUT', body: bytes('x') })).status).toBe(401)
    expect((await call('/api/v1/attachments/abc')).status).toBe(401)
  })

  it('stores the streamed body, and downloads the same bytes with the stored size', async () => {
    const { cookie, user } = await signIn(uniqueEmail())
    const ticket = await newTicket(cookie)
    const content = bytes('line 1\nline 2\n')
    const res = await put(`/api/v1/tickets/${ticket.ref}/attachments`, cookie, content, { 'x-filename': encodeURIComponent('Bericht été.txt') })
    expect(res.status).toBe(201)
    const file = await res.json() as Uploaded
    expect(file).toMatchObject({ filename: 'Bericht été.txt', size: content.length, content_type: 'text/plain', ticket_number: ticket.number, uploader_id: user.id })
    expect((await env.FILES.head(file.id))?.size).toBe(content.length)

    const download = await call(file.url, { headers: { cookie } })
    expect(download.status).toBe(200)
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(content)

    const list = await call(`/api/v1/tickets/${ticket.ref}/attachments`, { headers: { cookie } })
    expect(await list.json()).toEqual({ data: [file] })
  })

  it('refuses an upload without Content-Length', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const ticket = await newTicket(cookie)
    const body = new ReadableStream({ pull(controller) { controller.enqueue(bytes('data')); controller.close() } })
    const res = await call(`/api/v1/tickets/${ticket.ref}/attachments`, {
      method: 'PUT', body, duplex: 'half', headers: { cookie, 'x-filename': 'a.txt' },
    } as RequestInit)
    expect(res.status).toBe(411)
    expect(((await res.json()) as ErrorBody).error).toMatchObject({ code: 'LENGTH_REQUIRED', message: expect.stringContaining('Content-Length') })
  })

  it('refuses a file above 25 MB and accepts one of exactly 25 MB', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const ticket = await newTicket(cookie)
    const tooBig = await put(`/api/v1/tickets/${ticket.ref}/attachments`, cookie, new Uint8Array(MAX + 1))
    expect(tooBig.status).toBe(413)
    expect(((await tooBig.json()) as ErrorBody).error).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'The file must be 25 MB or smaller.' })

    const exact = await put(`/api/v1/tickets/${ticket.ref}/attachments`, cookie, new Uint8Array(MAX))
    expect(exact.status).toBe(201)
    expect(((await exact.json()) as Uploaded).size).toBe(MAX)
  })

  it('refuses a missing file name, an empty file, and a body shorter than Content-Length', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const ticket = await newTicket(cookie)
    const path = `/api/v1/tickets/${ticket.ref}/attachments`
    const noName = await call(path, { method: 'PUT', body: bytes('x'), headers: { cookie } })
    expect(noName.status).toBe(422)
    expect(((await noName.json()) as ErrorBody).error.code).toBe('FILENAME_REQUIRED')
    const empty = await put(path, cookie, new Uint8Array(0))
    expect(empty.status).toBe(422)

    const short = await call(path, {
      method: 'PUT', body: new Blob([bytes('abc')]).stream(), duplex: 'half', headers: { cookie, 'x-filename': 'a.txt', 'content-length': '10' },
    } as RequestInit)
    expect(short.status).toBe(400)
    expect(((await short.json()) as ErrorBody).error.code).toBe('UPLOAD_INCOMPLETE')
    const list = (await (await call(`${path}`, { headers: { cookie } })).json()) as { data: unknown[] }
    expect(list.data).toEqual([])
  })

  it('hides the files of a ticket from a User who cannot read it, and from lists, uploads and downloads alike', async () => {
    const owner = await signIn(uniqueEmail())
    const other = await signIn(uniqueEmail())
    const ticket = await newTicket(owner.cookie)
    const file = await (await put(`/api/v1/tickets/${ticket.ref}/attachments`, owner.cookie, bytes('secret'))).json() as Uploaded

    const download = await call(file.url, { headers: { cookie: other.cookie } })
    expect(download.status).toBe(404)
    expect(await download.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No attachment with this ID.', details: null } })
    // The same answer as for a file that does not exist.
    expect((await call('/api/v1/attachments/does-not-exist', { headers: { cookie: other.cookie } })).status).toBe(404)
    expect((await call(`/api/v1/tickets/${ticket.ref}/attachments`, { headers: { cookie: other.cookie } })).status).toBe(404)
    expect((await put(`/api/v1/tickets/${ticket.ref}/attachments`, other.cookie, bytes('x'))).status).toBe(404)

    const agent = await signInAs('agent')
    expect((await call(file.url, { headers: { cookie: agent.cookie } })).status).toBe(200)
    expect((await call(file.url, { headers: { cookie: owner.cookie } })).status).toBe(200)
  })

  it('lets a Requester read a file of a "visible to all" ticket', async () => {
    const author = await signIn(uniqueEmail())
    const reader = await signIn(uniqueEmail())
    const res = await postJson('/api/v1/tickets', { ticket_type_id: await createVisibleType(), title: 'Notice' }, { cookie: author.cookie })
    const ticket = await res.json() as { ref: string }
    const file = await (await put(`/api/v1/tickets/${ticket.ref}/attachments`, author.cookie, bytes('hello'))).json() as Uploaded
    expect((await call(file.url, { headers: { cookie: reader.cookie } })).status).toBe(200)
    expect((await put(`/api/v1/tickets/${ticket.ref}/attachments`, reader.cookie, bytes('mine'))).status).toBe(201)
  })

  it('serves every download as an attachment with nosniff, and never as script', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const ticket = await newTicket(cookie)
    const upload = async (name: string, type: string) => await (await put(`/api/v1/tickets/${ticket.ref}/attachments`, cookie, bytes('<script>alert(1)</script>'), {
      'x-filename': encodeURIComponent(name), 'content-type': type,
    })).json() as Uploaded

    const html = await call((await upload('page.html', 'text/html; charset=utf-8')).url, { headers: { cookie } })
    const svg = await call((await upload('image.svg', 'image/svg+xml')).url, { headers: { cookie } })
    const png = await call((await upload('Quote"d ünï.png', 'image/png')).url, { headers: { cookie } })
    const weird = await call((await upload('x.bin', 'not a type')).url, { headers: { cookie } })

    for (const res of [html, svg, png, weird]) {
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; /)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    }
    expect(html.headers.get('content-type')).toBe('application/octet-stream')
    expect(svg.headers.get('content-type')).toBe('application/octet-stream')
    expect(weird.headers.get('content-type')).toBe('application/octet-stream')
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(png.headers.get('content-disposition')).toBe('attachment; filename="Quote_d _n_.png"; filename*=UTF-8\'\'Quote%22d%20%C3%BCn%C3%AF.png')
  })

  it('removes path parts and control characters from the file name', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const file = await (await put('/api/v1/attachments', cookie, bytes('x'), { 'x-filename': encodeURIComponent('../etc/pass\r\nwd') })).json() as Uploaded
    expect(file.filename).toBe('.._etc_pass__wd')
  })
})

describe('uploads before the ticket exists', () => {
  it('belong to the uploader alone, and a file Field can claim them on a new ticket', async () => {
    const owner = await signIn(uniqueEmail())
    const other = await signIn(uniqueEmail())
    const type = await createFileType()
    const file = await (await put('/api/v1/attachments', owner.cookie, bytes('shot'))).json() as Uploaded
    expect(file.ticket_number).toBeNull()
    expect((await call(file.url, { headers: { cookie: owner.cookie } })).status).toBe(200)
    expect((await call(file.url, { headers: { cookie: other.cookie } })).status).toBe(404)
    // A staff User cannot read it either: no ticket owns it yet.
    const agent = await signInAs('agent')
    expect((await call(file.url, { headers: { cookie: agent.cookie } })).status).toBe(404)

    // Another User cannot use the reference.
    const stolen = await postJson('/api/v1/tickets', { ticket_type_id: type, title: 'T', fields: { screenshot: file.id } }, { cookie: other.cookie })
    expect(stolen.status).toBe(422)
    expect(((await stolen.json()) as { error: { details: { key: string }[] } }).error.details[0]).toMatchObject({ key: 'screenshot', reason: expect.stringContaining('file you uploaded') })
    expect((await postJson('/api/v1/tickets', { ticket_type_id: type, title: 'T', fields: { screenshot: 'no-such-file' } }, { cookie: owner.cookie })).status).toBe(422)

    const created = await postJson('/api/v1/tickets', { ticket_type_id: type, title: 'With a screenshot', fields: { screenshot: file.id } }, { cookie: owner.cookie })
    expect(created.status).toBe(201)
    const ticket = await created.json() as { ref: string, number: number, fields: Record<string, unknown> }
    expect(ticket.fields).toEqual({ screenshot: file.id })
    const list = await (await call(`/api/v1/tickets/${ticket.ref}/attachments`, { headers: { cookie: owner.cookie } })).json() as { data: Uploaded[] }
    expect(list.data.map(f => [f.id, f.ticket_number])).toEqual([[file.id, ticket.number]])
    // The agent can read it now, through the ticket.
    expect((await call(file.url, { headers: { cookie: agent.cookie } })).status).toBe(200)

    // A file that belongs to a ticket cannot go on a second one.
    const again = await postJson('/api/v1/tickets', { ticket_type_id: type, title: 'Again', fields: { screenshot: file.id } }, { cookie: owner.cookie })
    expect(again.status).toBe(422)
  })

  it('refuses a file Field value that is not text', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const type = await createFileType()
    const res = await postJson('/api/v1/tickets', { ticket_type_id: type, title: 'T', fields: { screenshot: 7 } }, { cookie })
    expect(res.status).toBe(422)
  })
})
