// A tiny Ticket App for the e2e tests, on its own port (another origin than Tikki).
import { createServer } from 'node:http'

const port = Number(process.env.E2E_APP_PORT ?? Number(process.env.E2E_PORT ?? 8799) + 100)

const page = `<!doctype html>
<meta charset="utf-8">
<title>Test app</title>
<body style="font: 14px system-ui; margin: 8px">
<p>Ticket: <span id="ref">none</span> · contexts: <span id="count">0</span></p>
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
  if (mode === 'normal') parent.postMessage({ type: 'tikki:fetch-context' }, TIKKI)
  // A page on another origin in the same frame: Tikki must ignore it and send it nothing.
  if (mode === 'hostile') {
    parent.postMessage({ type: 'tikki:resize', height: 400 }, '*')
    parent.postMessage({ type: 'tikki:fetch-context' }, '*')
  }
</script>`

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/health') return res.writeHead(200).end('ok')
  if (path === '/app.html') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  res.writeHead(404).end()
}).listen(port, () => console.log(`test Ticket App on ${port}`))
