// The page in the iframe. Colors, font and radius follow Tikki (app/assets/css/main.css), so the card looks native.

const CSS = `
:root {
  color-scheme: light;
  --text-hi: #17181c; --text: #2b2e35; --muted: #5b606b; --dim: #8a8f98;
  --bg: #ffffff; --bg-muted: #f2f3f5; --bg-elev: #f7f8fa; --bg-acc: #e9ebee; --inv: #17181c; --on-inv: #ffffff;
  --border: #e4e6ea; --border-muted: #eef0f3;
  --ok: #157a52; --bad: #c43d3d; --ring: #9db4e8;
  --radius: 8px;
}
/* A frame whose color-scheme differs from Tikki's is painted opaque, so it follows Tikki's theme. */
:root[data-theme="dark"] {
  color-scheme: dark;
  --text-hi: #f4f5f7; --text: #d7d9de; --muted: #9ea3ad; --dim: #6b7079;
  --bg: #17181c; --bg-muted: #0f1013; --bg-elev: #1e2025; --bg-acc: #26282e; --inv: #f4f5f7; --on-inv: #17181c;
  --border: #2a2d33; --border-muted: #222429;
  --ok: #4cc38a; --bad: #ef7a7a; --ring: #4a6aa8;
}
* { box-sizing: border-box }
html, body { margin: 0; background: transparent; overflow-x: hidden }
body { padding: 2px 1px 6px; font: 13px/1.45 Geist, ui-sans-serif, system-ui, sans-serif; color: var(--text); -webkit-font-smoothing: antialiased }
button, input { font: inherit; color: inherit }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px }
[hidden] { display: none !important }

.summary { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; margin-bottom: 12px }
.total { font-size: 24px; line-height: 1; font-weight: 650; letter-spacing: -.02em; color: var(--text-hi); font-variant-numeric: tabular-nums }
.label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); margin-bottom: 5px }
.mine { text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums }
.mine b { color: var(--text-hi); font-weight: 600 }

.composer { padding: 10px; border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: var(--bg-elev); display: grid; gap: 8px }
.quick { display: flex; gap: 4px; flex-wrap: wrap }
.chip { padding: 3px 9px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); font-size: 12px; font-weight: 500; color: var(--muted); cursor: pointer; font-variant-numeric: tabular-nums }
.chip:hover { color: var(--text-hi); border-color: var(--border-accented, var(--dim)) }
.chip[aria-pressed="true"] { background: var(--inv); border-color: var(--inv); color: var(--on-inv) }
.field { position: relative }
.input { width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text-hi) }
.input::placeholder { color: var(--dim) }
.input[aria-invalid="true"] { border-color: var(--bad) }
.hint { position: absolute; right: 10px; top: 0; height: 32px; display: flex; align-items: center; font-size: 12px; color: var(--dim); pointer-events: none; font-variant-numeric: tabular-nums }
.hint.bad { color: var(--bad) }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 8px }
.switch { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); cursor: pointer; user-select: none; min-width: 0 }
.switch input { appearance: none; flex: none; width: 26px; height: 16px; margin: 0; border-radius: 999px; background: var(--bg-acc); position: relative; cursor: pointer; transition: background .15s }
.switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--bg); box-shadow: 0 1px 2px rgb(0 0 0 / .25); transition: transform .15s }
.switch input:checked { background: var(--inv) }
.switch input:checked::after { transform: translateX(10px) }
.switch input:disabled, .switch input:disabled + span { opacity: .5; cursor: not-allowed }
.primary { flex: none; height: 30px; padding: 0 12px; border: 0; border-radius: var(--radius); background: var(--inv); color: var(--on-inv); font-weight: 600; cursor: pointer }
.primary:disabled { opacity: .45; cursor: default }
.status { min-height: 0; font-size: 12px; color: var(--muted) }
.status:empty { display: none }
.status.ok { color: var(--ok) } .status.bad { color: var(--bad) }
.status button { margin-left: 6px; padding: 0; border: 0; background: none; color: var(--text-hi); font-weight: 600; text-decoration: underline; cursor: pointer }

.entries { list-style: none; margin: 12px 0 0; padding: 0 }
.entry { display: grid; grid-template-columns: 24px 1fr auto; gap: 1px 9px; padding: 8px 0; border-top: 1px solid var(--border-muted) }
.entry:first-child { border-top: 0 }
.avatar { grid-row: span 2; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600; background: var(--bg-acc); color: var(--muted) }
.who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-hi); font-weight: 500 }
.when { color: var(--dim); font-weight: 400 }
.amount { font-weight: 600; color: var(--text-hi); font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 2px }
.note { grid-column: 2 / 4; color: var(--muted); overflow-wrap: anywhere }
.delete { width: 22px; height: 22px; margin: -2px 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: none; color: var(--dim); cursor: pointer; opacity: 0 }
.entry:hover .delete, .delete:focus-visible { opacity: 1 }
@media (hover: none) { .delete { opacity: 1 } }
.delete:hover { background: var(--bg-acc); color: var(--bad) }
.more { width: 100%; margin-top: 4px; padding: 6px; border: 0; border-radius: var(--radius); background: none; color: var(--muted); font-size: 12px; font-weight: 500; cursor: pointer }
.more:hover { background: var(--bg-elev); color: var(--text-hi) }

.empty { display: grid; justify-items: center; gap: 4px; padding: 16px 8px 6px; text-align: center; color: var(--muted) }
.empty svg { color: var(--dim) }
.empty b { color: var(--text-hi); font-weight: 600 }
.skeleton { display: grid; gap: 8px }
.bone { height: 12px; border-radius: 6px; background: var(--bg-acc); animation: pulse 1.2s ease-in-out infinite }
@keyframes pulse { 50% { opacity: .5 } }
@media (prefers-reduced-motion: reduce) { .bone { animation: none } * { transition: none !important } }
`

const CLOCK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
const TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>'

const BODY = `
<div id="loading" class="skeleton" aria-busy="true" aria-label="Loading">
  <div class="bone" style="width: 40%; height: 22px"></div>
  <div class="bone" style="height: 32px"></div>
  <div class="bone" style="width: 70%"></div>
</div>
<main id="app" hidden>
  <div class="summary">
    <div><div class="label">Logged on this ticket</div><div id="total" class="total">0m</div></div>
    <div id="mine" class="mine"></div>
  </div>
  <form id="form" class="composer" autocomplete="off" novalidate>
    <div class="quick" role="group" aria-label="Quick durations">
      <button type="button" class="chip" data-min="15" aria-pressed="false">15m</button>
      <button type="button" class="chip" data-min="30" aria-pressed="false">30m</button>
      <button type="button" class="chip" data-min="60" aria-pressed="false">1h</button>
      <button type="button" class="chip" data-min="120" aria-pressed="false">2h</button>
    </div>
    <div class="field">
      <input id="duration" class="input" type="text" inputmode="text" placeholder="Time spent, e.g. 1h 30m" aria-label="Time spent" aria-describedby="hint">
      <span id="hint" class="hint" aria-live="polite"></span>
    </div>
    <input id="note" class="input" type="text" placeholder="What did you work on? (optional)" aria-label="Note" maxlength="500">
    <div class="actions">
      <label class="switch" id="post-label"><input id="post" type="checkbox"><span>Note on ticket</span></label>
      <button id="add" class="primary" type="submit" disabled>Log time</button>
    </div>
    <div id="status" class="status" role="status"></div>
  </form>
  <ul id="entries" class="entries" aria-label="Time entries"></ul>
  <button id="more" class="more" type="button" hidden></button>
</main>
`

/** Runs in the browser. Serialised with toString(), so it must not use anything from this module. */
function client(TIKKI, CLOCK, TRASH) {
  const $ = (id) => document.getElementById(id)
  const SHOWN = 5
  const UNDO_MS = 5000
  let token = null
  let agentLabel = ''
  let data = null
  let showAll = false
  const pendingDelete = new Map()

  function parseDuration(text) {
    const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!t) return null
    let m
    if ((m = /^(\d+):([0-5]?\d)$/.exec(t))) return Number(m[1]) * 60 + Number(m[2])
    if ((m = /^(\d+(?:\.\d+)?) ?h(?:ours?|rs?)?(?: ?(\d+) ?m(?:in(?:utes?)?)?)?$/.exec(t))) return Math.round(Number(m[1]) * 60) + Number(m[2] || 0)
    if ((m = /^(\d+) ?m?(?:in(?:utes?)?)?$/.exec(t))) return Number(m[1])
    return null
  }
  const hm = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? h + 'h ' + m + 'm' : h + 'h') : m + 'm' }
  const ago = (ms) => {
    const s = (Date.now() - ms) / 1000
    if (s < 60) return 'just now'
    if (s < 3600) return Math.floor(s / 60) + ' min ago'
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago'
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago'
    return new Date(ms).toLocaleDateString()
  }
  const initials = (name) => (name.match(/[A-Za-z0-9]/g) || ['?']).slice(0, 1).join('').toUpperCase()
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

  function resize() {
    requestAnimationFrame(() => parent.postMessage({ type: 'tikki:resize', height: document.documentElement.scrollHeight + 2 }, TIKKI))
  }
  function status(text, kind, undo) {
    const s = $('status')
    s.className = 'status' + (kind ? ' ' + kind : '')
    s.replaceChildren(text)
    if (undo) {
      const b = el('button', null, 'Undo')
      b.type = 'button'
      b.onclick = undo
      s.append(b)
    }
    resize()
  }

  // Live feedback on the typed time, and the state of the quick buttons.
  function syncDuration() {
    const raw = $('duration').value
    const min = parseDuration(raw)
    const hint = $('hint')
    const bad = raw.trim() !== '' && (min === null || min < 1 || min > 1440)
    hint.textContent = bad ? (min > 1440 ? 'Max 24h' : 'e.g. 45m, 1h 30m') : (min ? '= ' + hm(min) : '')
    hint.className = 'hint' + (bad ? ' bad' : '')
    $('duration').setAttribute('aria-invalid', bad ? 'true' : 'false')
    $('add').disabled = !min || bad
    for (const c of document.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(Number(c.dataset.min) === min))
    return bad ? null : min
  }

  function render() {
    $('loading').hidden = true
    $('app').hidden = false
    const visible = data.entries.filter(e => !pendingDelete.has(e.id))
    const total = visible.reduce((s, e) => s + e.minutes, 0)
    const mine = visible.filter(e => e.mine).reduce((s, e) => s + e.minutes, 0)
    $('total').textContent = hm(total)
    $('mine').replaceChildren()
    if (visible.length) {
      const b = el('b', null, hm(mine))
      $('mine').append('You ', b, el('div', null, visible.length === 1 ? '1 entry' : visible.length + ' entries'))
    }

    const canNote = data.scope === 'comment' || data.scope === 'update'
    $('post').disabled = !canNote
    $('post-label').title = canNote ? 'Also add an internal note to the ticket.' : 'Needs Comment access. An Admin sets it on the Ticket Apps page.'
    if (!canNote) $('post').checked = false

    const list = $('entries')
    list.replaceChildren()
    if (!visible.length) {
      const li = el('li', 'empty')
      li.innerHTML = CLOCK
      li.append(el('b', null, 'No time logged yet'), el('span', null, 'Pick a duration above to log your first entry.'))
      list.append(li)
    }
    for (const e of showAll ? visible : visible.slice(0, SHOWN)) {
      const li = el('li', 'entry')
      li.append(el('span', 'avatar', initials(e.agent_label)))
      const who = el('div', 'who', e.mine ? 'You' : e.agent_label)
      const when = el('span', 'when', ' · ' + ago(e.created_at))
      when.title = new Date(e.created_at).toLocaleString()
      who.title = e.agent_label
      who.append(when)
      const amount = el('div', 'amount', hm(e.minutes))
      if (e.mine) {
        const del = el('button', 'delete')
        del.type = 'button'
        del.innerHTML = TRASH
        del.setAttribute('aria-label', 'Delete ' + hm(e.minutes) + ' entry')
        del.onclick = () => remove(e)
        amount.append(del)
      }
      li.append(who, amount)
      if (e.note) li.append(el('div', 'note', e.note))
      list.append(li)
    }
    const more = $('more')
    more.hidden = visible.length <= SHOWN
    more.textContent = showAll ? 'Show less' : 'Show all ' + visible.length + ' entries'
    resize()
  }

  async function call(path, init = {}) {
    const res = await fetch(path, { ...init, headers: { ...init.headers, authorization: 'Bearer ' + token } })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401) {
      parent.postMessage({ type: 'tikki:fetch-context' }, TIKKI)
      throw new Error('Your session was renewed. Try again.')
    }
    if (!res.ok) throw new Error(body.message || body.error || 'Something went wrong (' + res.status + ').')
    return body
  }

  // Delete waits UNDO_MS, so Undo needs no server call. If the frame closes first, the entry stays: the safe side.
  function remove(entry) {
    const timer = setTimeout(async () => {
      pendingDelete.delete(entry.id)
      try {
        data = await call('/api/entries/' + entry.id, { method: 'DELETE' })
      } catch (e) {
        status(e.message, 'bad')
      }
      render()
    }, UNDO_MS)
    pendingDelete.set(entry.id, timer)
    render()
    status('Deleted ' + hm(entry.minutes) + '.', null, () => {
      clearTimeout(pendingDelete.get(entry.id))
      pendingDelete.delete(entry.id)
      status('')
      render()
    })
  }

  for (const chip of document.querySelectorAll('.chip')) {
    chip.onclick = () => {
      $('duration').value = hm(Number(chip.dataset.min))
      syncDuration()
      $('note').focus()
    }
  }
  $('duration').addEventListener('input', syncDuration)
  try { $('post').checked = localStorage.getItem('tikki-time-post') === '1' } catch {}
  $('post').addEventListener('change', () => { try { localStorage.setItem('tikki-time-post', $('post').checked ? '1' : '0') } catch {} })
  $('more').onclick = () => { showAll = !showAll; render() }

  $('form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const minutes = syncDuration()
    if (!minutes) return $('duration').focus()
    $('add').disabled = true
    $('add').textContent = 'Logging…'
    try {
      data = await call('/api/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minutes, note: $('note').value, post_note: $('post').checked, agent_label: agentLabel }),
      })
      $('duration').value = ''
      $('note').value = ''
      syncDuration()
      render()
      if (data.ticket_note === 'added') {
        status('Logged ' + hm(minutes) + ' and added a note to the ticket.', 'ok')
        parent.postMessage({ type: 'tikki:refresh' }, TIKKI)
      } else if (data.ticket_note.startsWith('failed')) {
        status('Logged ' + hm(minutes) + '. The ticket note failed (' + data.ticket_note.slice(8) + ').', 'bad')
      } else {
        status('Logged ' + hm(minutes) + '.', 'ok')
      }
    } catch (e) {
      status(e.message, 'bad')
    } finally {
      $('add').textContent = 'Log time'
      syncDuration()
    }
  })

  addEventListener('message', (event) => {
    if (event.origin !== TIKKI || event.source !== window.parent) return
    const msg = event.data
    if (!msg || msg.type !== 'tikki:context') return
    const first = token === null
    token = msg.token
    agentLabel = msg.data.agent.name || msg.data.agent.email
    document.documentElement.dataset.theme = msg.data.theme
    if (first) call('/api/entries').then((d) => { data = d; render() }, (e) => { $('loading').hidden = true; $('app').hidden = false; status(e.message, 'bad') })
  })
  setInterval(() => data && render(), 60000)
  parent.postMessage({ type: 'tikki:fetch-context' }, TIKKI)
  resize()
}

export function page(tikki) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Time tracking</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap">
<style>${CSS}</style>
<body>${BODY}
<script>(${client.toString()})(${JSON.stringify(tikki)}, ${JSON.stringify(CLOCK)}, ${JSON.stringify(TRASH)})</script>
</body>
</html>`
}
