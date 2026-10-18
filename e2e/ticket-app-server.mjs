// A tiny Ticket App for the e2e tests, on its own port (another origin than Tikki).
import { createServer } from 'node:http'

const port = Number(process.env.E2E_APP_PORT ?? Number(process.env.E2E_PORT ?? 8799) + 100)

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
    window.tikkiLog.push({ ref: msg.data.ticket.ref, theme: msg.data.theme, token: msg.token, expires_at: msg.expires_at, data: msg.data })
    document.getElementById('ref').textContent = msg.data.ticket.ref
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

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/health') return res.writeHead(200).end('ok')
  if (path === '/note' && req.method === 'POST') return addNote(req, res).catch(() => res.writeHead(502).end())
  if (path === '/app.html') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  res.writeHead(404).end()
}).listen(port, () => console.log(`test Ticket App on ${port}`))
