// The two views inside a ticket: the sidebar card and the tab. One client, two layouts.
import { ICONS, html } from './ui.js'

const CSS = `
.mine { text-align: right; font-size: 12px; color: var(--muted) }
.mine b { color: var(--text-hi); font-weight: 600 }
.composer { padding: 10px; border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: var(--bg-elev); display: grid; gap: 8px }
.quick { display: flex; gap: 4px; flex-wrap: wrap }
.chip { padding: 3px 9px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); font-size: 12px; font-weight: 500; color: var(--muted); cursor: pointer; font-variant-numeric: tabular-nums }
.chip:hover { color: var(--text-hi); border-color: var(--border-acc) }
.chip[aria-pressed="true"] { background: var(--inv); border-color: var(--inv); color: var(--on-inv) }
.field { position: relative }
.hint { position: absolute; right: 10px; top: 0; height: 100%; display: flex; align-items: center; font-size: 12px; color: var(--dim); pointer-events: none; font-variant-numeric: tabular-nums }
.hint.bad { color: var(--bad) }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 8px }
.switch { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); cursor: pointer; user-select: none; min-width: 0 }
.switch input { appearance: none; flex: none; width: 26px; height: 16px; margin: 0; border-radius: 999px; background: var(--bg-acc); position: relative; cursor: pointer; transition: background .15s }
.switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--bg); box-shadow: 0 1px 2px rgb(0 0 0 / .25); transition: transform .15s }
.switch input:checked { background: var(--inv) }
.switch input:checked::after { transform: translateX(10px) }
.switch input:disabled, .switch input:disabled + span { opacity: .5; cursor: not-allowed }

.entries { list-style: none; margin: 0; padding: 0 }
.entry { display: grid; grid-template-columns: 24px 1fr auto; gap: 1px 9px; padding: 8px 0; border-top: 1px solid var(--border-muted) }
.entry:first-child { border-top: 0 }
.entry .avatar { grid-row: span 2 }
.who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-hi); font-weight: 500 }
.when { color: var(--dim); font-weight: 400 }
.amount { font-weight: 600; color: var(--text-hi); font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 2px }
.note { grid-column: 2 / 4; color: var(--muted); overflow-wrap: anywhere; white-space: pre-wrap }
.delete { width: 22px; height: 22px; margin: -2px 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: none; color: var(--dim); cursor: pointer; opacity: 0 }
.entry:hover .delete, .delete:focus-visible { opacity: 1 }
@media (hover: none) { .delete { opacity: 1 } }
.delete:hover { background: var(--bg-acc); color: var(--bad) }
.more { width: 100%; margin-top: 4px; padding: 6px; border: 0; border-radius: var(--radius); background: none; color: var(--muted); font-size: 12px; font-weight: 500; cursor: pointer }
.more:hover { background: var(--bg-elev); color: var(--text-hi) }

/* Sidebar: a small card. */
body.sidebar { padding: 2px 1px 6px }
body.sidebar .summary { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; margin-bottom: 12px }
body.sidebar .entries { margin-top: 12px }

/* Tab: the full log. Two columns when the main column is wide. */
body.tab { padding: 16px }
body.tab main { max-width: 1040px; margin: 0 auto; display: grid; gap: 16px }
body.tab .summary { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 28px }
body.tab .total { font-size: 28px }
body.tab .stat .value { font-size: 15px; font-weight: 600; color: var(--text-hi) }
body.tab .cols { display: grid; gap: 16px; align-items: start }
@media (min-width: 760px) { body.tab .cols { grid-template-columns: minmax(280px, 340px) 1fr } }
body.tab .composer { padding: 14px; gap: 10px }
body.tab .chip { padding: 5px 12px; font-size: 13px }
body.tab .input { height: 36px }
body.tab textarea.input { height: auto; min-height: 64px; padding: 8px 10px; resize: vertical; line-height: 1.45 }
body.tab .primary { height: 34px; padding: 0 14px }
.panel { border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: var(--bg); padding: 12px 14px }
.panel h2 { margin: 0 0 8px; display: flex; justify-content: space-between; gap: 8px }
.people { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px }
.person { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 4px 9px }
.person .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-hi); font-weight: 500 }
.person .sum { font-weight: 600; color: var(--text-hi); font-variant-numeric: tabular-nums }
.track { grid-column: 2 / 4; height: 4px; border-radius: 999px; background: var(--bg-acc); overflow: hidden }
.track span { display: block; height: 100%; border-radius: inherit; background: var(--bar) }
.day { display: flex; justify-content: space-between; gap: 8px; margin: 14px 0 2px; padding-bottom: 4px; border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--muted) }
.day:first-child { margin-top: 0 }
.day .num { color: var(--text-hi) }
body.tab .entry:first-child, body.tab .day + .entry { border-top: 0 }
`

const COMPOSER = (tab) => `
  <form id="form" class="composer" autocomplete="off" novalidate>
    <div class="quick" role="group" aria-label="Quick durations">
      <button type="button" class="chip" data-min="15" aria-pressed="false">15m</button>
      <button type="button" class="chip" data-min="30" aria-pressed="false">30m</button>
      <button type="button" class="chip" data-min="60" aria-pressed="false">1h</button>
      <button type="button" class="chip" data-min="120" aria-pressed="false">2h</button>
    </div>
    <div class="field">
      <input id="duration" class="input" type="text" placeholder="Time spent, e.g. 1h 30m" aria-label="Time spent" aria-describedby="hint">
      <span id="hint" class="hint" aria-live="polite"></span>
    </div>
    ${tab
      ? '<textarea id="note" class="input" rows="3" placeholder="What did you work on? (optional)" aria-label="Note" maxlength="500"></textarea>'
      : '<input id="note" class="input" type="text" placeholder="What did you work on? (optional)" aria-label="Note" maxlength="500">'}
    <div class="actions">
      <label class="switch" id="post-label"><input id="post" type="checkbox"><span>Note on ticket</span></label>
      <button id="add" class="primary" type="submit" disabled>Log time</button>
    </div>
    <div id="status" class="status" role="status"></div>
  </form>`

const SIDEBAR_BODY = `
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
  ${COMPOSER(false)}
  <ul id="entries" class="entries" aria-label="Time entries"></ul>
  <button id="more" class="more" type="button" hidden></button>
</main>`

const TAB_BODY = `
<div id="loading" class="skeleton" aria-busy="true" aria-label="Loading" style="max-width: 1040px; margin: 0 auto">
  <div class="bone" style="width: 160px; height: 28px"></div>
  <div class="bone" style="height: 140px"></div>
  <div class="bone" style="width: 70%"></div>
  <div class="bone" style="width: 50%"></div>
</div>
<main id="app" hidden>
  <div class="summary">
    <div><div class="label">Logged on this ticket</div><div id="total" class="total">0m</div></div>
    <div class="stat"><div class="label">You</div><div id="mine" class="value num">0m</div></div>
    <div class="stat"><div class="label">Entries</div><div id="count" class="value num">0</div></div>
    <div class="stat"><div class="label">People</div><div id="people-count" class="value num">0</div></div>
  </div>
  <div class="cols">
    <div style="display: grid; gap: 16px">
      ${COMPOSER(true)}
      <section class="panel" id="people-panel" aria-labelledby="people-title">
        <h2 class="label" id="people-title">By person</h2>
        <ul id="people" class="people"></ul>
      </section>
    </div>
    <section class="panel" aria-labelledby="log-title">
      <h2 class="label" id="log-title">All entries</h2>
      <ul id="entries" class="entries" aria-label="Time entries"></ul>
    </section>
  </div>
</main>`

/** Runs in the browser. Serialised with toString(), so it must not use anything from this module. */
function view(lib, MODE, ICONS) {
  const { $, el, hm, ago, initials, post, call } = lib
  const TAB = MODE === 'tab'
  const SHOWN = 5
  const UNDO_MS = 5000
  let ctx = null
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

  function resize() {
    if (TAB) return
    requestAnimationFrame(() => post({ type: 'tikki:resize', height: document.documentElement.scrollHeight + 2 }))
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

  function entryItem(e, showDate) {
    const li = el('li', 'entry')
    li.append(el('span', 'avatar', initials(e.agent_label)))
    const who = el('div', 'who', e.mine ? 'You' : e.agent_label)
    const time = new Date(e.created_at)
    const when = el('span', 'when', ' · ' + (showDate ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ago(e.created_at)))
    when.title = time.toLocaleString()
    who.title = e.agent_label
    who.append(when)
    const amount = el('div', 'amount', hm(e.minutes))
    if (e.mine) {
      const del = el('button', 'delete')
      del.type = 'button'
      del.innerHTML = ICONS.trash
      del.setAttribute('aria-label', 'Delete ' + hm(e.minutes) + ' entry')
      del.onclick = () => remove(e)
      amount.append(del)
    }
    li.append(who, amount)
    if (e.note) li.append(el('div', 'note', e.note))
    return li
  }

  function emptyItem() {
    const li = el('li', 'empty')
    li.innerHTML = ICONS.clock
    li.append(el('b', null, 'No time logged yet'), el('span', null, 'Pick a duration to log your first entry.'))
    return li
  }

  const dayKey = (ms) => new Date(ms).toDateString()
  function dayName(ms) {
    const key = dayKey(ms)
    const now = new Date()
    if (key === now.toDateString()) return 'Today'
    if (key === new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString()) return 'Yesterday'
    return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }

  function renderTab(visible, total) {
    const people = new Map()
    for (const e of visible) {
      const p = people.get(e.agent_id) || { label: e.agent_label, mine: e.mine, minutes: 0 }
      p.minutes += e.minutes
      people.set(e.agent_id, p)
    }
    $('count').textContent = String(visible.length)
    $('people-count').textContent = String(people.size)
    $('people-panel').hidden = !people.size
    $('people').replaceChildren(...[...people.values()].sort((a, b) => b.minutes - a.minutes).map((p) => {
      const li = el('li', 'person')
      const bar = el('div', 'track')
      const fill = el('span')
      fill.style.width = (total ? Math.max(2, Math.round(p.minutes / total * 100)) : 0) + '%'
      bar.append(fill)
      bar.setAttribute('aria-hidden', 'true')
      const name = el('span', 'name', p.mine ? p.label + ' (you)' : p.label)
      name.title = p.label
      li.append(el('span', 'avatar', initials(p.label)), name, el('span', 'sum', hm(p.minutes)), bar)
      return li
    }))

    const list = $('entries')
    list.replaceChildren()
    if (!visible.length) return list.append(emptyItem())
    let day = null
    for (const e of visible) {
      if (dayKey(e.created_at) !== day) {
        day = dayKey(e.created_at)
        const sum = visible.filter(x => dayKey(x.created_at) === day).reduce((s, x) => s + x.minutes, 0)
        const h = el('li', 'day')
        h.append(el('span', null, dayName(e.created_at)), el('span', 'num', hm(sum)))
        list.append(h)
      }
      list.append(entryItem(e, true))
    }
  }

  function renderSidebar(visible, mine) {
    $('mine').replaceChildren()
    if (visible.length) $('mine').append('You ', el('b', null, hm(mine)), el('div', null, visible.length === 1 ? '1 entry' : visible.length + ' entries'))
    const list = $('entries')
    list.replaceChildren()
    if (!visible.length) list.append(emptyItem())
    for (const e of showAll ? visible : visible.slice(0, SHOWN)) list.append(entryItem(e, false))
    const more = $('more')
    more.hidden = visible.length <= SHOWN
    more.textContent = showAll ? 'Show less' : 'Show all ' + visible.length + ' entries'
  }

  function render() {
    $('loading').hidden = true
    $('app').hidden = false
    const visible = data.entries.filter(e => !pendingDelete.has(e.id))
    const total = visible.reduce((s, e) => s + e.minutes, 0)
    const mine = visible.filter(e => e.mine).reduce((s, e) => s + e.minutes, 0)
    $('total').textContent = hm(total)

    const canNote = data.scope === 'comment' || data.scope === 'update'
    $('post').disabled = !canNote
    $('post-label').title = canNote ? 'Also add an internal note to the ticket.' : 'Needs Comment access. An Admin sets it on the Ticket Apps page.'
    if (!canNote) $('post').checked = false

    if (TAB) {
      $('mine').textContent = hm(mine)
      renderTab(visible, total)
    } else {
      renderSidebar(visible, mine)
    }
    resize()
  }

  // Delete waits UNDO_MS, so Undo needs no server call. If the frame closes first, the entry stays: the safe side.
  // One Undo at a time: a new delete sends the pending one at once.
  async function commit(id) {
    const pending = pendingDelete.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingDelete.delete(id)
    try {
      data = await call('/api/entries/' + id, { method: 'DELETE' })
      if (pending.shown) status('Deleted ' + hm(pending.minutes) + '.')
    } catch (e) {
      status(e.message, 'bad')
    }
    render()
  }

  function remove(entry) {
    for (const p of pendingDelete.values()) p.shown = false
    for (const id of [...pendingDelete.keys()]) commit(id)
    const pending = { minutes: entry.minutes, shown: true }
    pending.timer = setTimeout(() => commit(entry.id), UNDO_MS)
    pendingDelete.set(entry.id, pending)
    render()
    status('Deleted ' + hm(entry.minutes) + '.', null, () => {
      clearTimeout(pending.timer)
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
  // A textarea takes Enter for new lines, so Ctrl or Cmd + Enter logs.
  $('note').addEventListener('keydown', (e) => { if (TAB && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('form').requestSubmit() })
  try { $('post').checked = localStorage.getItem('tikki-time-post') === '1' } catch {}
  $('post').addEventListener('change', () => { try { localStorage.setItem('tikki-time-post', $('post').checked ? '1' : '0') } catch {} })
  if (!TAB) $('more').onclick = () => { showAll = !showAll; render() }

  $('form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const minutes = syncDuration()
    if (!minutes) return $('duration').focus()
    if (!ctx) return
    $('add').disabled = true
    $('add').textContent = 'Logging…'
    try {
      data = await call('/api/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          minutes,
          note: $('note').value,
          post_note: $('post').checked,
          agent_label: ctx.agent.name || ctx.agent.email,
          ticket_title: ctx.ticket.title,
          ticket_type: ctx.ticket.ticket_type?.name ?? '',
        }),
      })
      $('duration').value = ''
      $('note').value = ''
      syncDuration()
      render()
      if (data.ticket_note === 'added') {
        status('Logged ' + hm(minutes) + ' and added a note to the ticket.', 'ok')
        post({ type: 'tikki:refresh' })
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

  lib.onContext((context, first) => {
    ctx = context
    if (first) {
      call('/api/entries').then(
        (d) => { data = d; render() },
        (e) => { $('loading').hidden = true; $('app').hidden = false; status(e.message, 'bad') },
      )
    }
  })
  setInterval(() => data && render(), 60000)
  post({ type: 'tikki:fetch-context' })
  resize()
}

export function sidebarPage(tikki) {
  return html({ title: 'Time tracking', tikki, css: CSS, bodyClass: 'sidebar', body: SIDEBAR_BODY, view, args: ['sidebar', ICONS] })
}

export function tabPage(tikki) {
  return html({ title: 'Time tracking', tikki, css: CSS, bodyClass: 'tab', body: TAB_BODY, view, args: ['tab', ICONS] })
}
