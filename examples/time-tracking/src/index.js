// Example Ticket App: Agents log time on a ticket; a timesheet page shows it across tickets. Contract: docs/ticket-apps.md.
// Every API call needs a context token. The ticket, the User and the role come only from the checked token.
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { sidebarPage, tabPage } from './ticket.js'
import { timesheetPage } from './timesheet.js'
import iconLight from '../icons/icon-light.svg'
import iconDark from '../icons/icon-dark.svg'

const MAX_MINUTES = 24 * 60
const MAX_RANGE_MS = 400 * 86400000
const TIMESHEET_ROWS = 5000
let jwks

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** The checked payload, or a 401 Response. */
async function verify(token, request, env) {
  if (!token) return json(401, { error: 'NO_TOKEN' })
  jwks ??= createRemoteJWKSet(new URL(`${env.TIKKI_ORIGIN}/api/auth/jwks`))
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${env.TIKKI_ORIGIN}/api/auth`,
      audience: new URL(request.url).origin,
    })
    return payload
  } catch (error) {
    return json(401, { error: error.code ?? 'INVALID_TOKEN' })
  }
}

const bearer = (request) => /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1]

/** A sidebar or tab token. All views share one origin, so a page token has the same audience: refuse it here. */
async function ticketClaims(request, env) {
  const token = bearer(request)
  const p = await verify(token, request, env)
  if (p instanceof Response) return p
  if ((p.tikki_placement !== 'sidebar' && p.tikki_placement !== 'tab') || typeof p.tikki_ticket !== 'string') {
    return json(403, { error: 'WRONG_PLACEMENT' })
  }
  return { token, agentId: p.sub, ticket: p.tikki_ticket, scope: p.tikki_scope }
}

/** A page token. Admins see every person's time, Agents their own, anyone else nothing. */
async function pageClaims(token, request, env) {
  const p = await verify(token, request, env)
  if (p instanceof Response) return p
  if (p.tikki_placement !== 'page') return json(403, { error: 'WRONG_PLACEMENT' })
  if (p.tikki_role !== 'admin' && p.tikki_role !== 'agent') {
    return json(403, { error: 'FORBIDDEN', message: 'The timesheet is for Agents and Admins.' })
  }
  return { userId: p.sub, role: p.tikki_role }
}

const text = (value, max) => String(value ?? '').trim().slice(0, max)

async function list(env, c) {
  const { results } = await env.TIME.prepare(
    'SELECT id, agent_id, agent_label, minutes, note, created_at FROM time_entry WHERE ticket_ref = ? ORDER BY created_at DESC, id DESC',
  ).bind(c.ticket).all()
  return json(200, {
    ticket: c.ticket,
    scope: c.scope,
    total_minutes: results.reduce((sum, e) => sum + e.minutes, 0),
    entries: results.map(e => ({ ...e, mine: e.agent_id === c.agentId })),
  })
}

function hm(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

async function add(request, env, c) {
  const body = await request.json().catch(() => null)
  const minutes = body?.minutes
  const note = text(body?.note, 500)
  // Display text from the browser context: never used for a decision.
  const label = text(body?.agent_label, 200) || c.agentId
  const title = text(body?.ticket_title, 300)
  const type = text(body?.ticket_type, 100)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    return json(422, { error: 'INVALID_MINUTES', message: `Minutes must be a whole number from 1 to ${MAX_MINUTES}.` })
  }
  const insert = env.TIME.prepare('INSERT INTO time_entry (ticket_ref, agent_id, agent_label, minutes, note, created_at, ticket_title, ticket_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(c.ticket, c.agentId, label, minutes, note, Date.now(), title, type)
  // The timesheet shows the newest title and type for all entries of the ticket.
  const rename = env.TIME.prepare('UPDATE time_entry SET ticket_title = ?, ticket_type = ? WHERE ticket_ref = ?').bind(title, type, c.ticket)
  await env.TIME.batch(title ? [insert, rename] : [insert])

  // Optional: an internal note on the ticket, through the Tikki API with the same token. Needs `comment` access.
  let ticketNote = 'skipped'
  if (body?.post_note) {
    if (c.scope !== 'comment' && c.scope !== 'update') {
      ticketNote = 'no_access'
    } else {
      const res = await fetch(`${env.TIKKI_ORIGIN}/api/v1/tickets/${encodeURIComponent(c.ticket)}/comments`, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${c.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ body: `Logged ${hm(minutes)}${note ? `: ${note}` : '.'}`, visibility: 'internal' }),
      })
      ticketNote = res.ok ? 'added' : `failed: ${(await res.json().catch(() => null))?.error?.code ?? res.status}`
    }
  }
  const listed = await (await list(env, c)).json()
  return json(201, { ...listed, ticket_note: ticketNote })
}

async function remove(env, c, id) {
  // Only the Agent who logged an entry can delete it.
  const { meta } = await env.TIME.prepare('DELETE FROM time_entry WHERE id = ? AND ticket_ref = ? AND agent_id = ?')
    .bind(id, c.ticket, c.agentId).run()
  if (!meta.changes) return json(404, { error: 'NOT_FOUND' })
  return list(env, c)
}

/** [from, to) in epoch ms, or a 422 Response. */
function range(from, to) {
  const a = Number(from)
  const b = Number(to)
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a >= b || b - a > MAX_RANGE_MS) {
    return json(422, { error: 'INVALID_RANGE', message: 'Pick a start date before the end date, at most 400 days apart.' })
  }
  return [a, b]
}

async function timesheetEntries(env, c, [from, to], limit) {
  const own = c.role !== 'admin'
  const { results } = await env.TIME.prepare(
    `SELECT id, ticket_ref, ticket_title, ticket_type, agent_id, agent_label, minutes, note, created_at FROM time_entry
     WHERE created_at >= ? AND created_at < ?${own ? ' AND agent_id = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(...(own ? [from, to, c.userId] : [from, to]), limit).all()
  return results
}

async function timesheet(request, env, url) {
  const c = await pageClaims(bearer(request), request, env)
  if (c instanceof Response) return c
  const r = range(url.searchParams.get('from'), url.searchParams.get('to'))
  if (r instanceof Response) return r
  const rows = await timesheetEntries(env, c, r, TIMESHEET_ROWS + 1)
  return json(200, { role: c.role, truncated: rows.length > TIMESHEET_ROWS, entries: rows.slice(0, TIMESHEET_ROWS) })
}

/** A spreadsheet runs a cell that starts with = + - or @ as a formula, so such cells get a leading quote. */
function cell(value) {
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function zone(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  } catch {
    return zone('UTC')
  }
}

// The export opens in its own tab, so an error is plain text for a person.
const failed = (status, code) => new Response(`The export failed (${code}). Close this tab and try again.\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

// A form POST from the page, so the browser downloads the file: the frame sandbox has no allow-downloads.
async function timesheetCsv(request, env) {
  const form = await request.formData().catch(() => null)
  if (!form) return failed(400, 'BAD_FORM')
  const c = await pageClaims(form.get('token'), request, env)
  if (c instanceof Response) return failed(c.status, (await c.json()).error)
  const r = range(form.get('from'), form.get('to'))
  if (r instanceof Response) return failed(r.status, 'INVALID_RANGE')
  const fmt = zone(form.get('tz'))
  const rows = await timesheetEntries(env, c, r, 100000)
  const lines = [['Date', 'Time', 'Ticket', 'Title', 'Ticket Type', 'Person', 'Minutes', 'Hours', 'Note']]
  const parts = (ms) => Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  const day = (ms) => { const p = parts(ms); return `${p.year}-${p.month}-${p.day}` }
  for (const e of rows.reverse()) {
    const p = parts(e.created_at)
    lines.push([day(e.created_at), `${p.hour}:${p.minute}`, e.ticket_ref, e.ticket_title, e.ticket_type, e.agent_label, e.minutes, (e.minutes / 60).toFixed(2), e.note])
  }
  // The BOM makes Excel read the file as UTF-8.
  return new Response('﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="timesheet-${day(r[0])}-to-${day(r[1] - 1)}.csv"`,
      'cache-control': 'no-store',
    },
  })
}

const PAGES = { '/': sidebarPage, '/sidebar': sidebarPage, '/tab': tabPage, '/timesheet': timesheetPage }
const ICON_FILES = { '/icon-light.svg': iconLight, '/icon-dark.svg': iconDark }

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const page = PAGES[url.pathname]
    if (page && request.method === 'GET') {
      return new Response(page(env.TIKKI_ORIGIN), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `frame-ancestors ${env.TIKKI_ORIGIN}`,
        },
      })
    }
    if (ICON_FILES[url.pathname]) {
      return new Response(ICON_FILES[url.pathname], { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } })
    }
    if (url.pathname === '/api/timesheet' && request.method === 'GET') return timesheet(request, env, url)
    if (url.pathname === '/api/timesheet.csv') return request.method === 'POST' ? timesheetCsv(request, env) : failed(405, 'USE_EXPORT_BUTTON')
    if (!url.pathname.startsWith('/api/entries')) return new Response('Not found', { status: 404 })
    const c = await ticketClaims(request, env)
    if (c instanceof Response) return c
    const id = /^\/api\/entries\/(\d+)$/.exec(url.pathname)?.[1]
    if (url.pathname === '/api/entries' && request.method === 'GET') return list(env, c)
    if (url.pathname === '/api/entries' && request.method === 'POST') return add(request, env, c)
    if (id && request.method === 'DELETE') return remove(env, c, Number(id))
    return json(405, { error: 'METHOD_NOT_ALLOWED' })
  },
}
