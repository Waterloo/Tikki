// A tiny Ticket App for the e2e tests, on its own port (another origin than Tikki).
import { createServer } from 'node:http'

const port = Number(process.env.E2E_APP_PORT ?? Number(process.env.E2E_PORT ?? 8799) + 100)
const tikki = `http://localhost:${Number(process.env.E2E_PORT ?? 8799)}`

const page = `<!doctype html>
<meta charset="utf-8">
<title>Test app</title>
<body style="font: 14px system-ui; margin: 8px">
<p>Ticket: <span id="ref">none</span> · contexts: <span id="count">0</span></p>
<button id="note" type="button" hidden>Add note</button> <span id="result"></span>
<script>
  const q = new URLSearchParams(location.search)
  const TIKKI = q.get('tikki')
  const mode = q.get('mode') || 'normal'
  window.tikkiLog = []
  addEventListener('message', (event) => {
    if (event.origin !== TIKKI || event.source !== window.parent) return
    const msg = event.data
    if (!msg || msg.type !== 'tikki:context') return
    // A page context (issue 39) has no ticket.
    const ref = msg.data.ticket ? msg.data.ticket.ref : 'none'
    window.tikkiLog.push({ ref, theme: msg.data.theme, token: msg.token, expires_at: msg.expires_at, data: msg.data })
    document.getElementById('ref').textContent = ref
    document.getElementById('count').textContent = String(window.tikkiLog.length)
  })
  // mode=writer: the button asks this app's backend to add an internal note, then tells Tikki to reload the ticket.
  if (mode === 'writer') {
    const button = document.getElementById('note')
    button.hidden = false
    button.addEventListener('click', async () => {
      const token = window.tikkiLog.at(-1)?.token
      const res = await fetch('/note', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'x-tikki': TIKKI } })
      document.getElementById('result').textContent = String(res.status)
      if (res.ok) parent.postMessage({ type: 'tikki:refresh' }, TIKKI)
    })
  }
  if (mode === 'normal' || mode === 'writer') parent.postMessage({ type: 'tikki:fetch-context' }, TIKKI)
  // A page on another origin in the same frame: Tikki must ignore it and send it nothing.
  if (mode === 'hostile') {
    parent.postMessage({ type: 'tikki:resize', height: 400 }, '*')
    parent.postMessage({ type: 'tikki:fetch-context' }, '*')
  }
</script>`

/** The backend of the test app: it adds an internal note to the ticket of the token, through the Tikki REST API. */
async function addNote(req, res) {
  const authorization = req.headers.authorization ?? ''
  // A real backend checks the token with the JWKS first (docs/ticket-apps.md); Tikki checks it again.
  const claims = JSON.parse(Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString() || '{}')
  const answer = await fetch(`${req.headers['x-tikki']}/api/v1/tickets/${claims.tikki_ticket}/comments`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Refund issued by the test app.', visibility: 'internal' }),
  })
  res.writeHead(answer.status, { 'content-type': 'application/json' }).end(await answer.text())
}

// Issue 40: a manifest for each `?key=`, so tests do not share one. PUT sets keys that replace the defaults.
const manifests = new Map()
const manifest = key => ({
  tikki_app: 1,
  name: 'Time tracking',
  description: 'Log time on tickets. Timesheet for the team.',
  urls: { sidebar: `/app.html?tikki=${encodeURIComponent(tikki)}&mode=normal`, page: `/app.html?tikki=${encodeURIComponent(tikki)}&mode=normal&view=timesheet` },
  icons: { light: '/icon-light.svg', dark: '/icon-dark.svg' },
  access: 'comment',
  ...manifests.get(key),
})
// A dark glyph for light backgrounds, and a light glyph for dark ones.
const icon = color => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`

async function setManifest(req, res, key) {
  let body = ''
  for await (const chunk of req) body += chunk
  manifests.set(key, JSON.parse(body))
  res.writeHead(204).end()
}

createServer((req, res) => {
  const { pathname: path, searchParams } = new URL(req.url, 'http://x')
  if (path === '/health') return res.writeHead(200).end('ok')
  if (path === '/tikki-app.json' && req.method === 'PUT') return setManifest(req, res, searchParams.get('key')).catch(() => res.writeHead(400).end())
  if (path === '/tikki-app.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(manifest(searchParams.get('key'))))
  if (path === '/icon-light.svg') return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(icon('#1F2937'))
  if (path === '/icon-dark.svg') return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(icon('#F3F4F6'))
  if (path === '/note' && req.method === 'POST') return addNote(req, res).catch(() => res.writeHead(502).end())
  if (path === '/app.html') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  res.writeHead(404).end()
}).listen(port, () => console.log(`test Ticket App on ${port}`))
