// A complete example Ticket App: one page, plus a backend route that checks the context token.
// Run from the repository root: node examples/ticket-app/server.mjs
//   TIKKI   Tikki's origin (default http://localhost:8787)
//   PORT    this app's port (default 5173); add http://localhost:<PORT>/ as the Sidebar URL of a Ticket App in Tikki
import { createServer } from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const TIKKI = process.env.TIKKI ?? 'http://localhost:8787'
const PORT = Number(process.env.PORT ?? 5173)
const ORIGIN = `http://localhost:${PORT}`
const jwks = createRemoteJWKSet(new URL(`${TIKKI}/api/auth/jwks`))

const page = `<!doctype html>
<meta charset="utf-8">
<title>Example Ticket App</title>
<style>
  :root { color-scheme: light dark; font: 13px/1.45 system-ui, sans-serif }
  body { margin: 10px }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 }
  dt { opacity: .65 } dd { margin: 0; overflow-wrap: anywhere }
  .ok { color: #1a9e6a } .bad { color: #d64545 }
  h3 { font-size: 12px; margin: 12px 0 4px; text-transform: uppercase; letter-spacing: .04em; opacity: .7 }
</style>
<body>
<p id="wait">Waiting for Tikki…</p>
<div id="out" hidden>
  <dl>
    <dt>Ticket</dt><dd id="ticket"></dd>
    <dt>Status</dt><dd id="status"></dd>
    <dt>Requester</dt><dd id="requester"></dd>
    <dt>Agent</dt><dd id="agent"></dd>
  </dl>
  <h3>Checked by the backend</h3>
  <p id="check">Checking the token…</p>
</div>
<script>
  const TIKKI = ${JSON.stringify(TIKKI)}
  const $ = (id) => document.getElementById(id)

  addEventListener('message', async (event) => {
    if (event.origin !== TIKKI || event.source !== window.parent) return
    const msg = event.data
    if (msg?.type !== 'tikki:context') return
    const { ticket, requester, agent, theme } = msg.data
    document.documentElement.style.colorScheme = theme
    $('wait').hidden = true
    $('out').hidden = false
    $('ticket').textContent = ticket.ref + ' · ' + ticket.title
    $('status').textContent = ticket.status.name + ' · ' + ticket.priority
    $('requester').textContent = requester.email + (requester.kind === 'contact' ? ' (customer, ' + (requester.external_id || 'no external id') + ')' : '')
    $('agent').textContent = agent.email + ' (' + agent.role + ')'

    // Only the checked token counts on the backend. The context above is display data.
    const res = await fetch('/api/check', { headers: { authorization: 'Bearer ' + msg.token } })
    const body = await res.json()
    $('check').className = res.ok ? 'ok' : 'bad'
    $('check').textContent = res.ok
      ? 'Valid: ' + body.agent + ' has ' + body.ticket + ' open, scope ' + body.scope + ', expires ' + new Date(body.exp * 1000).toLocaleTimeString()
      : 'Refused: ' + body.error

    parent.postMessage({ type: 'tikki:resize', height: document.body.scrollHeight + 20 }, TIKKI)
  })

  parent.postMessage({ type: 'tikki:fetch-context' }, TIKKI)
</script>`

async function check(req) {
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]
  if (!token) return [401, { error: 'no token' }]
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${TIKKI}/api/auth`, audience: ORIGIN })
    return [200, { agent: payload.sub, ticket: payload.tikki_ticket, scope: payload.tikki_scope, exp: payload.exp }]
  } catch (error) {
    return [401, { error: error.code ?? error.message }]
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url, ORIGIN).pathname
  if (path === '/') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `frame-ancestors ${TIKKI}` }).end(page)
  }
  if (path === '/api/check') {
    const [status, body] = await check(req)
    return res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  }
  res.writeHead(404).end()
}).listen(PORT, () => console.log(`Example Ticket App on ${ORIGIN}/ for Tikki at ${TIKKI}`))
