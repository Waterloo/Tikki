// Example Ticket App: Agents log time spent on a ticket. Contract: docs/ticket-apps.md.
// Every API call needs the context token. The ticket and the Agent come only from the checked token.
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { page } from './page.js'

const MAX_MINUTES = 24 * 60
let jwks

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** The checked claims, or a 401 Response. */
async function claims(request, env) {
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return json(401, { error: 'NO_TOKEN' })
  jwks ??= createRemoteJWKSet(new URL(`${env.TIKKI_ORIGIN}/api/auth/jwks`))
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${env.TIKKI_ORIGIN}/api/auth`,
      audience: new URL(request.url).origin,
    })
    return { token, agentId: payload.sub, ticket: payload.tikki_ticket, scope: payload.tikki_scope }
  } catch (error) {
    return json(401, { error: error.code ?? 'INVALID_TOKEN' })
  }
}

async function list(env, c) {
  const { results } = await env.TIME.prepare(
    'SELECT id, agent_id, agent_label, minutes, note, created_at FROM time_entry WHERE ticket_ref = ? ORDER BY created_at DESC',
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
  const note = String(body?.note ?? '').trim().slice(0, 500)
  const label = String(body?.agent_label ?? '').trim().slice(0, 200) || c.agentId
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    return json(422, { error: 'INVALID_MINUTES', message: `Minutes must be a whole number from 1 to ${MAX_MINUTES}.` })
  }
  await env.TIME.prepare('INSERT INTO time_entry (ticket_ref, agent_id, agent_label, minutes, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(c.ticket, c.agentId, label, minutes, note, Date.now()).run()

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/') {
      return new Response(page(env.TIKKI_ORIGIN), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `frame-ancestors ${env.TIKKI_ORIGIN}`,
        },
      })
    }
    if (!url.pathname.startsWith('/api/entries')) return new Response('Not found', { status: 404 })
    const c = await claims(request, env)
    if (c instanceof Response) return c
    const id = /^\/api\/entries\/(\d+)$/.exec(url.pathname)?.[1]
    if (url.pathname === '/api/entries' && request.method === 'GET') return list(env, c)
    if (url.pathname === '/api/entries' && request.method === 'POST') return add(request, env, c)
    if (id && request.method === 'DELETE') return remove(env, c, Number(id))
    return json(405, { error: 'METHOD_NOT_ALLOWED' })
  },
}
