import { EXAMPLE_ORIGIN } from './api'
import { REPO } from './markdown'

const cardIcon = (d: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`

const CARDS = [
  { href: '/docs/ticket-apps', title: 'Ticket Apps', tone: 'blue', meta: 'postMessage · JWT · no SDK', text: 'Your own page in the ticket sidebar or a tab. Tikki sends the ticket, the Agent and a signed token.', icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20M6 4v4M10 4v4"/>' },
  { href: '/docs/api', title: 'REST API', tone: 'green', meta: 'OpenAPI 3.1 · Bearer key', text: 'Create and read tickets for your customers with the API key of an Application.', icon: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>' },
  { href: '/docs/webhooks', title: 'Webhooks', tone: 'amber', meta: 'Standard Webhooks · at least once', text: 'A signed Event when a ticket is created, changed or gets a comment. With the ticket before and after.', icon: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>' },
  { href: '/docs/ai', title: 'AI assistants', tone: 'neutral', meta: 'MCP · OAuth 2.1 · WebMCP', text: 'Connect Claude, ChatGPT, Cursor or any MCP client. Users sign in. No API key.', icon: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>' },
]

const GOALS = [
  ['Show customer data next to a ticket', '/docs/ticket-apps', 'Ticket App', 'read'],
  ['Add a note or resolve a ticket from your tool', '/docs/ticket-apps#change-the-ticket', 'Ticket App', 'update'],
  ['Your website creates tickets for its customers', '/docs/api#create-ticket', 'REST API', ''],
  ['Sync ticket changes back into your system', '/docs/webhooks#two-kinds-of-endpoint', 'Application webhook', ''],
  ['Post every change to Slack or n8n', '/docs/webhooks', 'Admin webhook', ''],
  ['Staff raise tickets with one sentence', '/docs/ai', 'MCP connector', ''],
]

/** The home page. `firstCall` is the create-ticket sample from the API reference, so it matches the reference. */
export function homeBody(mascot: string, firstCall: string): string {
  return `<section class="hero">
<div>
<p class="eyebrow">Developer docs</p>
<h1>Build on Tikki</h1>
<p class="lead">Show your own tools inside a ticket. Create tickets from your systems. Get a signed Event for each change. Connect AI assistants.</p>
<p class="instance"><span class="dot" aria-hidden="true"></span>Examples use this instance: <code>${EXAMPLE_ORIGIN}</code></p>
</div>
<div class="mascot">${mascot}</div>
</section>
<section aria-labelledby="build"><h2 id="build" class="eyebrow">What you can build</h2>
<div class="cards-grid">${CARDS.map(c => `<a class="feature" href="${c.href}"><span class="feature-icon tone-${c.tone}">${cardIcon(c.icon)}</span><span class="feature-title">${c.title}</span><span class="feature-text">${c.text}</span><span class="feature-meta">${c.meta}</span></a>`).join('')}</div>
</section>
<div class="home-split">
<section><h2 id="which-one">Which one do I need?</h2><p class="muted">Find your goal. Use the tool on the right.</p>
<div class="table goals" data-scroll-x><table><tbody>${GOALS.map(([goal, href, tool, note]) => `<tr><td>${goal}</td><td><a href="${href}">${tool}</a>${note ? ` <span class="muted">· ${note}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
</section>
<section><h2 id="first-ticket">Your first ticket in one call</h2><p class="muted">Make an Application in Tikki, copy its API key, then run this.</p>
${firstCall}
</section>
</div>
<section class="resources">
<div><p class="feature-title">OpenAPI document</p><p class="muted">Load it in Postman or a code generator. <a href="/api/v1/openapi.json"><code>/api/v1/openapi.json</code></a></p></div>
<div><p class="feature-title">Docs for your AI</p><p class="muted">An index of every page as Markdown. <a href="/docs/llms.txt"><code>/docs/llms.txt</code></a></p></div>
<div><p class="feature-title">Example apps</p><p class="muted">A <a href="${REPO}/examples/time-tracking/README.md">time tracking app</a> and a <a href="${REPO}/examples/ticket-app/server.mjs">minimal app with a token check</a>.</p></div>
</section>`
}
