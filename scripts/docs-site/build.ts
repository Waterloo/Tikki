import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { methodBadge, operationAnchor, operations, renderApiReference, requestSamples, type OpenApiDocument } from './api'
import { renderPage, type NavGroup, type NavItem, type PageInput } from './layout'
import { loadHighlighter, renderMarkdown } from './markdown'
import { homeBody } from './pages'

/**
 * The developer docs (docs/writing-docs.md) as static files, keyed by their path in the public output. They are built
 * from the Markdown guides and the OpenAPI document on each build, so they cannot drift from the code, and Workers
 * static assets serve them without the Worker.
 */

/** The guides: their source, and their URL without `/docs/`. A page with `parent` shows under it in the menu. */
export const GUIDES: readonly { file: string, slug: string, label: string, parent?: string }[] = [
  { file: 'docs/ticket-apps.md', slug: 'ticket-apps', label: 'Ticket Apps' },
  { file: 'docs/ticket-apps-reference.md', slug: 'ticket-apps-reference', label: 'Reference', parent: 'ticket-apps' },
  { file: 'docs/webhooks.md', slug: 'webhooks', label: 'Webhooks' },
  { file: 'docs/ai-assistants.md', slug: 'ai', label: 'AI assistants (MCP)' },
]

export interface SearchEntry { page: string, title: string, url: string, text: string }

const FONTS = { 'Geist-Variable.woff2': 'geist-sans', 'GeistMono-Variable.woff2': 'geist-mono' } as const

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'' }
export const toText = (html: string) => html
  .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
  .replace(/<(svg|button|script)[\s\S]*?<\/\1>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(amp|lt|gt|quot|#39);/g, m => entities[m]!)
  .replace(/\s+/g, ' ')
  .trim()

/** One entry for each `##` and `###` section, and one for the text before the first. */
export function searchEntries(page: string, url: string, html: string): SearchEntry[] {
  const out: SearchEntry[] = []
  const re = /<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g
  let last = { title: page, url, from: 0 }
  for (let m = re.exec(html); ; m = re.exec(html)) {
    const text = toText(html.slice(last.from, m?.index ?? html.length)).slice(0, 1200)
    if (text) out.push({ page, title: last.title, url: last.url, text })
    if (!m) break
    last = { title: toText(m[3]!).replace(/^#\s*/, ''), url: `${url}#${m[2]}`, from: m.index + m[0].length }
  }
  return out
}

/** The CSS tokens of the web app, so the docs keep its colors and radius without a copy that can drift. */
export function appTokens(css: string): string {
  const root = /^:root \{[\s\S]*?^\}/m.exec(css)?.[0]
  const dark = /^\.dark \{[\s\S]*?^\}/m.exec(css)?.[0]
  if (!root || !dark) throw new Error('Docs: app/assets/css/main.css has no ":root {" or ".dark {" block at the start of a line.')
  return `${root}\n${dark}\n`
}

/** A short menu label from the operation id: `listTicketTypes` → "List ticket types". */
const navLabel = (id: string) => id.replace(/[A-Z]/g, c => ` ${c.toLowerCase()}`).replace(/^./, c => c.toUpperCase())

/** The default per-Application limits, read from the code that applies them. */
function apiLimits(root: string) {
  const src = readFileSync(join(root, 'server/utils/rate-limit.ts'), 'utf8')
  const read = (name: string) => {
    const m = new RegExp(`export const ${name} = (\\d+)`).exec(src)
    if (!m) throw new Error(`Docs: ${name} not found in server/utils/rate-limit.ts.`)
    return Number(m[1])
  }
  return { requests: read('DEFAULT_REQUEST_LIMIT'), creates: read('DEFAULT_CREATE_LIMIT') }
}

export async function buildDocsSite(root: string, openapi: OpenApiDocument): Promise<Map<string, string | Buffer>> {
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  const hl = await loadHighlighter()
  const files = new Map<string, string | Buffer>()

  const svg = read('docs/assets/tikki-mark.svg').replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  const mascot = svg.replace(/ width="\d+" height="\d+"/, ' width="148" height="148" aria-hidden="true" focusable="false"')
  // The small mark leaves out the cheeks: at 24 px they read as noise.
  const mark = svg.replace(/ width="\d+" height="\d+"/, ' width="26" height="26" aria-hidden="true" focusable="false"').replace(/<ellipse[^>]*><\/ellipse>/g, '')

  const pageUrl = Object.fromEntries(GUIDES.map(g => [g.file, `/docs/${g.slug}`]))
  const guides = GUIDES.map(g => ({ ...g, md: read(g.file), url: `/docs/${g.slug}` }))
    .map(g => ({ ...g, ...renderMarkdown(hl, g.md, { root, file: g.file, pages: pageUrl }) }))
  const api = renderApiReference(hl, openapi, apiLimits(root))
  const groups = operations(openapi)

  const nav: NavGroup[] = [
    { title: 'Start', items: [{ label: 'Overview', href: '/docs/' }] },
    { title: 'Guides', items: guides.map(g => ({ label: g.label, href: g.url, nested: !!g.parent })) },
    {
      title: 'API reference',
      items: [
        { label: 'Overview', href: '/docs/api' },
        ...groups.flatMap(gr => gr.ops.map(o => ({ label: navLabel(o.op.operationId), href: `/docs/api#${operationAnchor(o.op)}`, badge: methodBadge(o.method) }))),
        { label: 'Errors and limits', href: '/docs/api#errors-and-limits' },
      ],
    },
    { title: 'Files', items: [{ label: 'OpenAPI document', href: '/api/v1/openapi.json', external: true }, { label: 'llms.txt', href: '/docs/llms.txt', external: true }] },
  ]

  const order: NavItem[] = [{ label: 'Overview', href: '/docs/' }, ...guides.map(g => ({ label: g.parent ? `${GUIDES.find(p => p.slug === g.parent)!.label} reference` : g.label, href: g.url })), { label: 'API reference', href: '/docs/api' }]
  const around = (href: string) => {
    const i = order.findIndex(o => o.href === href)
    return { prev: order[i - 1], next: order[i + 1] }
  }

  const create = groups.flatMap(g => g.ops).find(o => o.op.operationId === 'createTicket')
  if (!create) throw new Error('Docs: the home page needs the createTicket operation.')
  const pages: (PageInput & { file: string })[] = [
    {
      file: 'docs/index.html', path: '/docs/', home: true, title: 'Tikki developer docs',
      description: 'Build Ticket Apps, use the REST API, receive signed webhooks, and connect AI assistants to Tikki.',
      lead: '', body: homeBody(mascot, requestSamples(hl, create)), headings: [], nav, source: 'scripts/docs-site/pages.ts',
    },
    ...guides.map(g => ({
      file: `docs/${g.slug}.html`, path: g.url, title: g.title, description: toText(g.lead),
      lead: g.lead, body: g.html, headings: g.headings, nav, source: g.file, markdown: `/docs/${g.slug}.md`, ...around(g.url),
    })),
    {
      file: 'docs/api.html', path: '/docs/api', wide: true, title: 'REST API', description: openapi.info.description,
      lead: openapi.info.description, body: api.html, headings: api.headings, nav, source: 'server/utils/openapi.ts', ...around('/docs/api'),
    },
  ]

  const search: SearchEntry[] = []
  for (const p of pages) {
    files.set(p.file, renderPage(p, mark))
    search.push(...searchEntries(p.title, p.path, p.home ? p.body : `<h1>${p.title}</h1>${p.lead}${p.body}`))
  }
  for (const g of guides) files.set(`docs/${g.slug}.md`, g.md)
  files.set('docs/search.json', JSON.stringify(search))
  files.set('docs/llms.txt', [
    '# Tikki developer docs',
    '',
    '> Tikki is a self-hosted ticketing system on one Cloudflare Worker. Build Ticket Apps, use the REST API, receive signed webhooks, and connect AI assistants through MCP.',
    '',
    '## Guides',
    '',
    ...guides.map(g => `- [${g.title}](/docs/${g.slug}.md): ${toText(g.lead)}`),
    '',
    '## API',
    '',
    `- [OpenAPI document](/api/v1/openapi.json): ${openapi.info.description}`,
    '',
  ].join('\n'))

  files.set('docs/assets/docs.css', appTokens(read('app/assets/css/main.css')) + read('scripts/docs-site/docs.css'))
  files.set('docs/assets/docs.js', read('scripts/docs-site/docs.js'))
  for (const [name, dir] of Object.entries(FONTS)) files.set(`docs/assets/${name}`, readFileSync(join(root, 'node_modules/geist/dist/fonts', dir, name)))
  return files
}

