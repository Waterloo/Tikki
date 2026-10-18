// What all three views share. Colors, font and radius follow Tikki (app/assets/css/main.css), so the views look native.

export const BASE_CSS = `
:root {
  color-scheme: light;
  --text-hi: #17181c; --text: #2b2e35; --muted: #5b606b; --dim: #8a8f98;
  --bg: #ffffff; --bg-muted: #f2f3f5; --bg-elev: #f7f8fa; --bg-acc: #e9ebee; --inv: #17181c; --on-inv: #ffffff;
  --border: #e4e6ea; --border-muted: #eef0f3; --border-acc: #dadde2; --hover: #eceef1; --row-hover: #f7f8fa;
  --link: #2b5bd7; --ok: #157a52; --bad: #c43d3d; --ring: #9db4e8; --bar: #3e63dd;
  --radius: 8px;
}
/* A frame whose color-scheme differs from Tikki's is painted opaque, so it follows Tikki's theme. */
:root[data-theme="dark"] {
  color-scheme: dark;
  --text-hi: #f4f5f7; --text: #d7d9de; --muted: #9ea3ad; --dim: #6b7079;
  --bg: #17181c; --bg-muted: #0f1013; --bg-elev: #1e2025; --bg-acc: #26282e; --inv: #f4f5f7; --on-inv: #17181c;
  --border: #2a2d33; --border-muted: #222429; --border-acc: #34373e; --hover: #1e2025; --row-hover: #1c1e22;
  --link: #8fb0f5; --ok: #4cc38a; --bad: #ef7a7a; --ring: #4a6aa8; --bar: #7b97ef;
}
* { box-sizing: border-box }
html, body { margin: 0; background: transparent; overflow-x: hidden }
body { font: 13px/1.45 Geist, ui-sans-serif, system-ui, sans-serif; color: var(--text); -webkit-font-smoothing: antialiased }
button, input, select, textarea { font: inherit; color: inherit }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px }
[hidden] { display: none !important }

.label { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); margin-bottom: 5px }
.total { font-size: 24px; line-height: 1; font-weight: 650; letter-spacing: -.02em; color: var(--text-hi); font-variant-numeric: tabular-nums }
.num { font-variant-numeric: tabular-nums }
.input { width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text-hi) }
.input::placeholder { color: var(--dim) }
.input[aria-invalid="true"] { border-color: var(--bad) }
.primary { flex: none; height: 30px; padding: 0 12px; border: 0; border-radius: var(--radius); background: var(--inv); color: var(--on-inv); font-weight: 600; cursor: pointer }
.primary:disabled { opacity: .45; cursor: default }
.secondary { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text-hi); font-weight: 500; cursor: pointer }
.secondary:hover { background: var(--hover) }
.secondary:disabled { opacity: .45; cursor: default }
.avatar { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600; background: var(--bg-acc); color: var(--muted) }
.status { font-size: 12px; color: var(--muted) }
.status:empty { display: none }
.status.ok { color: var(--ok) } .status.bad { color: var(--bad) }
.status button { margin-left: 6px; padding: 0; border: 0; background: none; color: var(--text-hi); font-weight: 600; text-decoration: underline; cursor: pointer }
.empty { display: grid; justify-items: center; gap: 4px; padding: 16px 8px 6px; text-align: center; color: var(--muted) }
.empty svg { color: var(--dim) }
.empty b { color: var(--text-hi); font-weight: 600 }
.skeleton { display: grid; gap: 8px }
.bone { height: 12px; border-radius: 6px; background: var(--bg-acc); animation: pulse 1.2s ease-in-out infinite }
@keyframes pulse { 50% { opacity: .5 } }
@media (prefers-reduced-motion: reduce) { .bone { animation: none } * { transition: none !important } }
`

export const ICONS = {
  clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
}

/** Runs in the browser, before the view. Serialised with toString(), so it must not use anything from this module. */
function lib(TIKKI) {
  let token = null
  let expiresAt = 0
  let waiters = []
  const listeners = []

  const post = (msg) => parent.postMessage(msg, TIKKI)
  const $ = (id) => document.getElementById(id)
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  const hm = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? h + 'h ' + m + 'm' : h + 'h') : m + 'm' }
  const initials = (name) => ((name || '').match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase()
  const ago = (ms) => {
    const s = (Date.now() - ms) / 1000
    if (s < 60) return 'just now'
    if (s < 3600) return Math.floor(s / 60) + ' min ago'
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago'
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago'
    return new Date(ms).toLocaleDateString()
  }

  addEventListener('message', (event) => {
    if (event.origin !== TIKKI || event.source !== window.parent) return
    const msg = event.data
    if (!msg || msg.type !== 'tikki:context') return
    const first = token === null
    token = msg.token
    expiresAt = Date.parse(msg.expires_at) || 0
    document.documentElement.dataset.theme = msg.data.theme
    waiters.splice(0).forEach(w => w.resolve())
    for (const fn of listeners) fn(msg.data, first)
  })

  function renew() {
    return new Promise((resolve, reject) => {
      const w = { resolve }
      waiters.push(w)
      post({ type: 'tikki:fetch-context' })
      setTimeout(() => { waiters = waiters.filter(x => x !== w); reject(new Error('Tikki did not answer. Reload the page.')) }, 10000)
    })
  }

  /** The token, renewed first when it ends within 30 s. */
  async function freshToken() {
    if (!token || expiresAt - Date.now() < 30000) await renew()
    return token
  }

  const MESSAGES = {
    WRONG_PLACEMENT: 'This view does not match the URL in Tikki. An Admin checks the Ticket App URLs.',
    FORBIDDEN: 'You cannot see this.',
  }

  /** A JSON call with the token. A refused token is renewed once; a refused request had no effect, so a retry is safe. */
  async function call(path, init = {}, retry = true) {
    const res = await fetch(path, { ...init, headers: { ...init.headers, authorization: 'Bearer ' + await freshToken() } })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 && retry) {
      await renew()
      return call(path, init, false)
    }
    if (!res.ok) {
      const error = new Error(body.message || MESSAGES[body.error] || (res.status === 401 ? 'Tikki refused the token. The app may be off.' : 'Something went wrong (' + res.status + ').'))
      error.status = res.status
      throw error
    }
    return body
  }

  return { $, el, hm, ago, initials, post, call, freshToken, onContext: (fn) => listeners.push(fn) }
}

/** One HTML page: `view(lib, ...args)` runs after the shared browser helpers. */
export function html({ title, tikki, css, bodyClass, body, view, args = [] }) {
  const call = [lib.toString(), JSON.stringify(tikki), view.toString(), ...args.map(a => JSON.stringify(a))]
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap">
<style>${BASE_CSS}${css}</style>
<body class="${bodyClass}">${body}
<script>(${call[2]})((${call[0]})(${call[1]})${call.slice(3).map(a => ', ' + a).join('')})</script>
</body>
</html>`
}
