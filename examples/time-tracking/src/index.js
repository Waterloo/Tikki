// Example Ticket App: Agents log time spent on a ticket. Contract: docs/ticket-apps.md.
// Every API call needs the context token. The ticket and the Agent come only from the checked token.
import { createRemoteJWKSet, jwtVerify } from 'jose'

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

function page(tikki) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Time tracking</title>
<style>
  /* A frame whose color-scheme differs from Tikki's is painted opaque, so it follows Tikki's theme. */
  :root { color-scheme: light; --fg: #1f1e24; --muted: #6b6a75; --line: #e4e3ea; --bg: transparent; --field: #fff; --accent: #e8a317; --bad: #d64545; --ok: #1a9e6a }
  :root[data-theme="dark"] { color-scheme: dark; --fg: #ecebf2; --muted: #9a99a6; --line: #34333d; --field: #1d1c23 }
  * { box-sizing: border-box }
  body { margin: 0; padding: 2px 2px 8px; font: 13px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg) }
  .total { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px }
  .total b { font-size: 22px; font-weight: 650; letter-spacing: -.01em }
  .total span { color: var(--muted) }
  form { display: grid; gap: 6px; margin-bottom: 12px }
  .row { display: flex; gap: 6px }
  input[type=text] { width: 100%; min-width: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--fg); font: inherit }
  #duration { flex: 1 1 auto }
  #add { flex: 0 0 auto; white-space: nowrap }
  button { padding: 6px 12px; border: 0; border-radius: 8px; background: var(--fg); color: var(--field); font: inherit; font-weight: 600; cursor: pointer }
  button:disabled { opacity: .5; cursor: default }
  label.check { display: flex; gap: 6px; align-items: center; color: var(--muted); font-size: 12px }
  .msg { min-height: 1em; font-size: 12px; color: var(--muted) }
  .msg.bad { color: var(--bad) } .msg.ok { color: var(--ok) }
  ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line) }
  li { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; padding: 7px 0; border-bottom: 1px solid var(--line) }
  li .who { color: var(--muted); font-size: 12px; overflow-wrap: anywhere }
  li .mins { font-weight: 600; text-align: right }
  li .note { grid-column: 1 / -1; overflow-wrap: anywhere }
  li .del { grid-column: 2; justify-self: end; padding: 0; background: none; color: var(--muted); font-size: 12px; font-weight: 400; text-decoration: underline }
  .empty { color: var(--muted); padding: 8px 0 }
</style>
<body>
<p id="wait" class="empty">Waiting for Tikki…</p>
<main id="app" hidden>
  <div class="total"><b id="total">0m</b><span id="count"></span></div>
  <form id="form" autocomplete="off">
    <div class="row">
      <input id="duration" type="text" placeholder="1h 30m" aria-label="Time spent" required>
      <button id="add" type="submit">Log time</button>
    </div>
    <input id="note" type="text" placeholder="What did you do? (optional)" aria-label="Note" maxlength="500">
    <label class="check"><input id="post" type="checkbox"> Add an internal note to the ticket</label>
    <div id="msg" class="msg" role="status"></div>
  </form>
  <ul id="list"></ul>
</main>
<script>
  const TIKKI = ${JSON.stringify(tikki)}
  const $ = (id) => document.getElementById(id)
  let token = null
  let agentLabel = ''

  // Accepts "90", "90m", "1h", "1h 30m", "1.5h" and "1:30". Returns minutes or null.
  function parseDuration(text) {
    const t = text.trim().toLowerCase()
    let m
    if ((m = /^(\\d+):(\\d{1,2})$/.exec(t))) return Number(m[1]) * 60 + Number(m[2])
    if ((m = /^(\\d+(?:\\.\\d+)?)\\s*h(?:\\s*(\\d+)\\s*m?)?$/.exec(t))) return Math.round(Number(m[1]) * 60) + Number(m[2] ?? 0)
    if ((m = /^(\\d+)\\s*m?$/.exec(t))) return Number(m[1])
    return null
  }
  const hm = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? h + 'h ' + m + 'm' : h + 'h') : m + 'm' }

  function resize() {
    parent.postMessage({ type: 'tikki:resize', height: document.documentElement.scrollHeight + 4 }, TIKKI)
  }
  function say(text, kind) {
    $('msg').textContent = text
    $('msg').className = 'msg' + (kind ? ' ' + kind : '')
  }

  function render(data) {
    $('wait').hidden = true
    $('app').hidden = false
    $('total').textContent = hm(data.total_minutes)
    $('count').textContent = data.entries.length === 1 ? '1 entry' : data.entries.length + ' entries'
    const canNote = data.scope === 'comment' || data.scope === 'update'
    $('post').disabled = !canNote
    $('post').parentElement.title = canNote ? '' : 'Needs Comment access. An Admin sets it on the Ticket Apps page.'
    const list = $('list')
    list.replaceChildren()
    if (!data.entries.length) {
      const li = document.createElement('li')
      li.className = 'empty'
      li.textContent = 'No time logged yet.'
      list.append(li)
    }
    for (const e of data.entries) {
      const li = document.createElement('li')
      const who = document.createElement('div')
      who.className = 'who'
      who.textContent = e.agent_label + ' · ' + new Date(e.created_at).toLocaleString()
      const mins = document.createElement('div')
      mins.className = 'mins'
      mins.textContent = hm(e.minutes)
      li.append(who, mins)
      if (e.note) {
        const note = document.createElement('div')
        note.className = 'note'
        note.textContent = e.note
        li.append(note)
      }
      if (e.mine) {
        const del = document.createElement('button')
        del.className = 'del'
        del.type = 'button'
        del.textContent = 'Delete'
        del.onclick = () => call('/api/entries/' + e.id, { method: 'DELETE' }).then(render, fail)
        li.append(del)
      }
      list.append(li)
    }
    resize()
  }

  async function call(path, init = {}) {
    const res = await fetch(path, { ...init, headers: { ...init.headers, authorization: 'Bearer ' + token } })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401) {
      // The token expired: get a new one and let the user try again.
      parent.postMessage({ type: 'tikki:fetch-context' }, TIKKI)
      throw new Error('The session was renewed. Try again.')
    }
    if (!res.ok) throw new Error(body.message || body.error || 'Request failed (' + res.status + ').')
    return body
  }
  const fail = (e) => { say(e.message, 'bad'); resize() }

  $('form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const minutes = parseDuration($('duration').value)
    if (!minutes || minutes > 1440) return fail(new Error('Type a time such as 45m, 1h 30m or 1:30 (at most 24h).'))
    $('add').disabled = true
    try {
      const data = await call('/api/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minutes, note: $('note').value, post_note: $('post').checked, agent_label: agentLabel }),
      })
      render(data)
      $('duration').value = ''
      $('note').value = ''
      if (data.ticket_note === 'added') {
        say('Logged ' + hm(minutes) + ' and added a note to the ticket.', 'ok')
        parent.postMessage({ type: 'tikki:refresh' }, TIKKI)
      } else if (data.ticket_note.startsWith('failed')) {
        say('Logged ' + hm(minutes) + ', but the ticket note was not added (' + data.ticket_note.slice(8) + ').', 'bad')
      } else {
        say('Logged ' + hm(minutes) + '.', 'ok')
      }
    } catch (e) {
      fail(e)
    } finally {
      $('add').disabled = false
      resize()
    }
  })

  addEventListener('message', (event) => {
    if (event.origin !== TIKKI || event.source !== window.parent) return
    const msg = event.data
    if (msg?.type !== 'tikki:context') return
    const first = token === null
    token = msg.token
    agentLabel = msg.data.agent.name || msg.data.agent.email
    document.documentElement.dataset.theme = msg.data.theme
    if (first) call('/api/entries').then(render, fail)
  })
  parent.postMessage({ type: 'tikki:fetch-context' }, TIKKI)
</script>
</html>`
}
