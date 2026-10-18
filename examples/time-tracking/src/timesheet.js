// The app page in Tikki's Apps menu: time across tickets, by ticket or by person.
import { ICONS, html } from './ui.js'

const CSS = `
body { padding: 20px 24px 32px }
main, #loading { max-width: 1100px; margin: 0 auto }
main { display: grid; gap: 16px }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px }
.spacer { flex: 1 }
.seg { display: inline-flex; padding: 2px; border-radius: var(--radius); background: var(--bg-acc); gap: 2px }
.seg button { height: 26px; padding: 0 10px; border: 0; border-radius: 6px; background: none; color: var(--muted); font-weight: 500; cursor: pointer; white-space: nowrap }
.seg button:hover { color: var(--text-hi) }
.seg button[aria-pressed="true"] { background: var(--bg); color: var(--text-hi); box-shadow: 0 1px 2px rgb(0 0 0 / .12) }
.custom { display: inline-flex; align-items: center; gap: 6px; color: var(--dim) }
.custom .input { width: auto; height: 30px; padding: 0 8px }
.scope { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; color: var(--muted) }
.scope b { color: var(--text-hi); font-weight: 600 }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px }
.stat { padding: 12px 14px; border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: var(--bg) }
.stat .value { font-size: 20px; font-weight: 650; letter-spacing: -.01em; color: var(--text-hi); font-variant-numeric: tabular-nums }

.groups { border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: var(--bg); overflow: hidden }
.head, .row { display: grid; grid-template-columns: minmax(0, 1fr) 90px 110px 70px; align-items: center; gap: 12px; padding: 0 14px }
.head { height: 34px; border-bottom: 1px solid var(--border); background: var(--bg-elev); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; color: var(--dim) }
.head .r, .row .r { text-align: right }
.group + .group { border-top: 1px solid var(--border-muted) }
.row { position: relative; min-height: 48px }
.row:hover { background: var(--row-hover) }
.toggle { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; padding: 8px 0; border: 0; background: none; text-align: left; cursor: pointer; color: var(--text-hi) }
/* The whole row opens the group; the ticket link sits above this layer. */
.toggle::after { content: ''; position: absolute; inset: 0 }
.toggle:focus-visible { outline: none }
.toggle:focus-visible::after { outline: 2px solid var(--ring); outline-offset: -2px }
.chev { flex: none; display: grid; color: var(--dim); transition: transform .15s }
.row:has([aria-expanded="true"]) .chev { transform: rotate(90deg) }
.main { display: flex; align-items: center; gap: 8px; min-width: 0 }
.text { min-width: 0; display: grid }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500 }
.sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dim) }
.ref { position: relative; z-index: 1; flex: none; font-weight: 600; color: var(--link); text-decoration: none; font-variant-numeric: tabular-nums }
.ref:hover { text-decoration: underline }
.count { color: var(--muted); font-variant-numeric: tabular-nums }
.track { height: 4px; border-radius: 999px; background: var(--bg-acc); overflow: hidden }
.track span { display: block; height: 100%; border-radius: inherit; background: var(--bar) }
.sum { font-weight: 600; color: var(--text-hi); font-variant-numeric: tabular-nums }

.detail { list-style: none; margin: 0; padding: 2px 14px 10px 36px; background: var(--bg-elev); border-top: 1px solid var(--border-muted) }
.item { display: grid; grid-template-columns: 92px minmax(0, 1fr) 70px; gap: 2px 12px; padding: 8px 0; border-top: 1px solid var(--border-muted) }
.item:first-child { border-top: 0 }
.item .date { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap }
.item .what { min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; color: var(--text-hi) }
.item .what .ref { font-weight: 500 }
.item .note { grid-column: 2 / 3; color: var(--muted); overflow-wrap: anywhere; white-space: pre-wrap }
.item .min { text-align: right; font-weight: 600; color: var(--text-hi); font-variant-numeric: tabular-nums }
.truncated { padding: 10px 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px }

.panel { display: grid; justify-items: center; gap: 6px; padding: 40px 16px; border: 1px dashed var(--border); border-radius: calc(var(--radius) + 2px); text-align: center; color: var(--muted) }
.panel svg { color: var(--dim) }
.panel b { color: var(--text-hi); font-weight: 600; font-size: 14px }
.panel.bad b { color: var(--bad) }

@media (max-width: 640px) {
  body { padding: 12px 12px 24px }
  .spacer { display: none }
  .toolbar > .seg:first-child { width: 100%; overflow-x: auto }
  .toolbar > .seg:first-child button { flex: 1 }
  .custom { width: 100% }
  .custom .input { flex: 1; min-width: 0 }
  #export { margin-left: auto }
  .head, .row { grid-template-columns: minmax(0, 1fr) 64px; padding: 0 12px }
  .head .count-h, .head .share-h, .row .count, .row .track { display: none }
  .detail { padding: 2px 12px 10px 12px }
  .item { grid-template-columns: minmax(0, 1fr) 56px }
  .item .date { grid-column: 1 / 3; font-size: 12px }
  .item .what { grid-column: 1 / 2 }
  .item .min { grid-row: 2; grid-column: 2 }
  .item .note { grid-column: 1 / 3 }
}
`

const BODY = `
<div id="loading" class="skeleton" aria-busy="true" aria-label="Loading">
  <div class="bone" style="width: 320px; max-width: 100%; height: 30px"></div>
  <div class="bone" style="width: 50%"></div>
  <div class="bone" style="height: 64px"></div>
  <div class="bone" style="height: 160px"></div>
</div>
<main id="app" hidden>
  <div class="toolbar">
    <div class="seg" role="group" aria-label="Date range" id="ranges">
      <button type="button" data-range="this-week">This week</button>
      <button type="button" data-range="last-week">Last week</button>
      <button type="button" data-range="this-month">This month</button>
      <button type="button" data-range="custom">Custom</button>
    </div>
    <div class="custom" id="custom" hidden>
      <input id="from" class="input" type="date" aria-label="From">
      <span>–</span>
      <input id="to" class="input" type="date" aria-label="To">
    </div>
    <div class="spacer"></div>
    <div class="seg" role="group" aria-label="Group by" id="groupby">
      <button type="button" data-group="ticket">By ticket</button>
      <button type="button" data-group="person">By person</button>
    </div>
    <button id="export" class="secondary" type="button" disabled>${ICONS.download}Export CSV</button>
  </div>
  <div class="scope"><b id="who"></b><span id="span"></span></div>
  <div class="stats" id="stats">
    <div class="stat"><div class="label">Total</div><div id="s-total" class="value">0m</div></div>
    <div class="stat"><div class="label">Entries</div><div id="s-entries" class="value">0</div></div>
    <div class="stat"><div class="label">Tickets</div><div id="s-tickets" class="value">0</div></div>
    <div class="stat" id="s-people-box"><div class="label">People</div><div id="s-people" class="value">0</div></div>
  </div>
  <div id="result" aria-live="polite"></div>
</main>
<div id="denied" class="panel" hidden>${ICONS.lock}<b>No timesheet for you</b><span id="denied-text"></span></div>
`

/** Runs in the browser. Serialised with toString(), so it must not use anything from this module. */
function view(lib, TIKKI, ICONS) {
  const { $, el, hm, initials, post, call } = lib
  const DAY = 86400000
  const store = { get: (k) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch {} } }
  let range = store.get('tikki-time-range') || 'this-week'
  let group = store.get('tikki-time-group') || 'ticket'
  let user = null
  let data = null
  let seq = 0
  let busy = false
  const open = new Set()

  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

  /** [start, end) as local dates. Weeks start on Monday. */
  function bounds() {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monday = addDays(today, -((today.getDay() + 6) % 7))
    if (range === 'last-week') return [addDays(monday, -7), monday]
    if (range === 'this-month') return [new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 1)]
    if (range === 'custom') {
      const a = $('from').value, b = $('to').value
      if (a && b && a <= b) return [fromIso(a), addDays(fromIso(b), 1)]
      return null
    }
    return [monday, addDays(monday, 7)]
  }

  function spanText([a, b]) {
    const last = addDays(b, -1)
    const f = (d, year) => d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) })
    return iso(a) === iso(last) ? f(a, true) : f(a, a.getFullYear() !== last.getFullYear()) + ' – ' + f(last, true)
  }

  function ticketLink(ref, cls) {
    const a = el('a', cls || 'ref', ref)
    a.href = TIKKI + '/tickets/' + encodeURIComponent(ref)
    a.target = '_blank'
    a.rel = 'noopener'
    a.title = 'Open ' + ref + ' in Tikki'
    // A plain click opens the ticket in this Tikki tab; a modified click keeps the browser's new-tab behaviour.
    a.onclick = (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      post({ type: 'tikki:navigate', path: '/tickets/' + encodeURIComponent(ref) })
    }
    return a
  }

  function groups(entries) {
    const map = new Map()
    for (const e of entries) {
      const key = group === 'ticket' ? e.ticket_ref : e.agent_id
      let g = map.get(key)
      if (!g) {
        g = group === 'ticket'
          ? { key, ref: e.ticket_ref, title: e.ticket_title, sub: e.ticket_type, minutes: 0, entries: [] }
          : { key, title: e.agent_id === user.id ? e.agent_label + ' (you)' : e.agent_label, minutes: 0, entries: [], people: true }
        map.set(key, g)
      }
      g.minutes += e.minutes
      g.entries.push(e)
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes || String(a.title).localeCompare(String(b.title)))
  }

  function panel(icon, title, text, kind, action) {
    const p = el('div', 'panel' + (kind ? ' ' + kind : ''))
    p.innerHTML = icon
    p.append(el('b', null, title), el('span', null, text))
    if (action) p.append(action)
    return p
  }

  function render() {
    $('loading').hidden = true
    $('app').hidden = false
    for (const b of $('ranges').children) b.setAttribute('aria-pressed', String(b.dataset.range === range))
    for (const b of $('groupby').children) b.setAttribute('aria-pressed', String(b.dataset.group === group))
    $('custom').hidden = range !== 'custom'
    const span = bounds()
    $('span').textContent = span ? spanText(span) : 'Pick a start and an end date.'
    // The role of the checked token, when the data has it.
    const admin = (data?.role ?? user?.role) === 'admin'
    $('who').textContent = admin ? 'Everyone’s time' : 'Your time'
    $('s-people-box').hidden = !admin

    const result = $('result')
    const entries = data?.entries ?? []
    $('export').disabled = !entries.length || busy
    $('s-total').textContent = hm(entries.reduce((s, e) => s + e.minutes, 0))
    $('s-entries').textContent = String(entries.length)
    $('s-tickets').textContent = String(new Set(entries.map(e => e.ticket_ref)).size)
    $('s-people').textContent = String(new Set(entries.map(e => e.agent_id)).size)
    $('stats').style.opacity = busy ? '.6' : ''

    if (!data) return
    if (!entries.length) {
      result.replaceChildren(panel(ICONS.clock, 'No time logged in this range', admin ? 'Time that Agents log on tickets shows here.' : 'Time you log on a ticket shows here.'))
      return
    }
    const list = groups(entries)
    const max = Math.max(...list.map(g => g.minutes))
    const box = el('div', 'groups')
    const head = el('div', 'head')
    head.append(el('span', null, group === 'ticket' ? 'Ticket' : 'Person'), el('span', 'r count-h', 'Entries'), el('span', 'share-h', 'Share'), el('span', 'r', 'Time'))
    box.append(head)
    for (const g of list) {
      const wrap = el('div', 'group')
      const row = el('div', 'row')
      const id = 'g-' + group + '-' + g.key.replace(/[^A-Za-z0-9_-]/g, '_')
      const toggle = el('button', 'toggle')
      toggle.type = 'button'
      toggle.setAttribute('aria-expanded', String(open.has(group + g.key)))
      toggle.setAttribute('aria-controls', id)
      const text = el('span', 'text')
      text.append(el('span', 'title', g.title || g.ref), el('span', 'sub', g.people ? (g.entries.length === 1 ? '1 entry' : g.entries.length + ' entries') : (g.sub || 'Ticket')))
      text.title = g.title || g.ref
      if (g.people) toggle.append(el('span', 'avatar', initials(g.title)))
      toggle.append(text)
      const chev = el('span', 'chev')
      chev.innerHTML = ICONS.chevron
      const main = el('div', 'main')
      main.append(chev)
      if (g.ref) main.append(ticketLink(g.ref))
      main.append(toggle)
      const track = el('div', 'track')
      const fill = el('span')
      fill.style.width = Math.max(3, Math.round(g.minutes / max * 100)) + '%'
      track.append(fill)
      track.setAttribute('aria-hidden', 'true')
      row.append(main, el('span', 'r count', String(g.entries.length)), track, el('span', 'r sum', hm(g.minutes)))

      const detail = el('ul', 'detail')
      detail.id = id
      detail.hidden = !open.has(group + g.key)
      for (const e of g.entries) {
        const li = el('li', 'item')
        const d = new Date(e.created_at)
        const date = el('span', 'date', d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))
        date.title = d.toLocaleString()
        const what = el('span', 'what')
        if (group === 'ticket') {
          what.append(el('span', null, e.agent_id === user.id ? 'You' : e.agent_label))
        } else {
          what.append(ticketLink(e.ticket_ref), el('span', null, e.ticket_title || ''))
        }
        li.append(date, what, el('span', 'min', hm(e.minutes)))
        if (e.note) li.append(el('span', 'note', e.note))
        detail.append(li)
      }
      toggle.onclick = () => {
        const k = group + g.key
        open.has(k) ? open.delete(k) : open.add(k)
        toggle.setAttribute('aria-expanded', String(open.has(k)))
        detail.hidden = !open.has(k)
      }
      wrap.append(row, detail)
      box.append(wrap)
    }
    if (data.truncated) box.append(el('div', 'truncated', 'Only the newest ' + entries.length + ' entries show. Pick a shorter range, or export CSV for all.'))
    result.replaceChildren(box)
  }

  async function load() {
    const span = bounds()
    if (!span) { data = { entries: [] }; return render() }
    const mine = ++seq
    busy = true
    render()
    try {
      const d = await call('/api/timesheet?from=' + span[0].getTime() + '&to=' + span[1].getTime())
      if (mine !== seq) return
      data = d
    } catch (e) {
      if (mine !== seq) return
      if (e.status === 403) {
        $('loading').hidden = true
        $('app').hidden = true
        $('denied').hidden = false
        $('denied-text').textContent = e.message
        return
      }
      const retry = el('button', 'secondary', 'Try again')
      retry.type = 'button'
      retry.onclick = load
      data = null
      $('result').replaceChildren(panel(ICONS.clock, 'The timesheet did not load', e.message, 'bad', retry))
    } finally {
      if (mine === seq) busy = false
    }
    render()
  }

  // The frame has no allow-downloads, so the file comes from a form POST in a new tab. The token goes in the body, not the URL.
  async function exportCsv() {
    const span = bounds()
    if (!span) return
    const token = await lib.freshToken()
    const form = el('form')
    form.method = 'POST'
    form.action = '/api/timesheet.csv'
    form.target = '_blank'
    const fields = { token, from: span[0].getTime(), to: span[1].getTime(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }
    for (const [name, value] of Object.entries(fields)) {
      const input = el('input')
      input.type = 'hidden'
      input.name = name
      input.value = String(value)
      form.append(input)
    }
    document.body.append(form)
    form.submit()
    form.remove()
  }

  function lastSevenDays() {
    $('from').value = iso(addDays(new Date(), -6))
    $('to').value = iso(new Date())
  }

  for (const b of $('ranges').children) {
    b.onclick = () => {
      range = b.dataset.range
      store.set('tikki-time-range', range)
      if (range === 'custom' && !$('from').value) lastSevenDays()
      load()
    }
  }
  for (const b of $('groupby').children) {
    b.onclick = () => { group = b.dataset.group; store.set('tikki-time-group', group); render() }
  }
  $('from').addEventListener('change', load)
  $('to').addEventListener('change', load)
  $('export').onclick = exportCsv
  if (range === 'custom') lastSevenDays()

  lib.onContext((context, first) => {
    user = context.user
    if (first) load()
  })
  post({ type: 'tikki:fetch-context' })
}

export function timesheetPage(tikki) {
  return html({ title: 'Timesheet', tikki, css: CSS, bodyClass: 'page', body: BODY, view, args: [tikki, ICONS] })
}
