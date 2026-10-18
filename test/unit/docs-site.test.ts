import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { appTokens, buildDocsSite, GUIDES, type SearchEntry } from '../../scripts/docs-site/build'
import { EXAMPLE_ORIGIN, operationAnchor, type OpenApiDocument } from '../../scripts/docs-site/api'
import { REPO } from '../../scripts/docs-site/markdown'
import { buildOpenApiDocument, openApiSchemas } from '../../server/utils/openapi'
import { TYPE_ICONS } from '../../shared/ticket-type-rules'

const ROOT = join(import.meta.dirname, '../..')
const doc = buildOpenApiDocument() as unknown as OpenApiDocument
let files: Map<string, string | Buffer>

beforeAll(async () => {
  files = await buildDocsSite(ROOT, doc)
}, 30_000)

const PAGES = ['docs/index.html', ...GUIDES.map(g => `docs/${g.slug}.html`), 'docs/api.html']
const html = (file: string) => String(files.get(file))
/** `/docs/webhooks` → `docs/webhooks.html`, the file Workers static assets serve for it. */
const fileOf = (path: string) => (path === '/docs/' ? 'docs/index.html' : `${path.slice(1)}${/\.\w+$/.test(path) ? '' : '.html'}`)
const ids = (page: string) => new Set([...html(page).matchAll(/ id="([^"]+)"/g)].map(m => m[1]))
/**
 * A constant of a server file, read from its source: the server modules import `cloudflare:workers`, which does not
 * load in Node. The expression may use MINUTE, HOUR and DAY.
 */
function constant(file: string, name: string): number {
  const m = new RegExp(`const ${name} = (.+)$`, 'm').exec(readFileSync(join(ROOT, file), 'utf8'))
  if (!m) throw new Error(`${name} not found in ${file}.`)
  return new Function('MINUTE', 'HOUR', 'DAY', `return ${m[1]}`)(60_000, 3_600_000, 86_400_000) as number
}
const guide = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const links = (page: string) => [...html(page).matchAll(/ href="([^"]+)"/g)].map(m => m[1]!.replace(/&amp;/g, '&'))

describe('docs site', () => {
  it('builds every page, its Markdown, the search index and the assets', () => {
    for (const f of [...PAGES, ...GUIDES.map(g => `docs/${g.slug}.md`), 'docs/search.json', 'docs/llms.txt', 'docs/assets/docs.css', 'docs/assets/docs.js', 'docs/assets/Geist-Variable.woff2']) {
      expect(files.has(f), f).toBe(true)
    }
    for (const g of GUIDES) expect(files.get(`docs/${g.slug}.md`)).toBe(readFileSync(join(ROOT, g.file), 'utf8'))
  })

  it('links only to pages and anchors that exist', () => {
    // Routes that the Worker or the SPA serves, not the docs build.
    const app = new Set(['/', '/api/v1/openapi.json', '/favicon.svg'])
    for (const page of PAGES) {
      for (const href of links(page)) {
        if (href.startsWith('#')) {
          expect(ids(page).has(href.slice(1)), `${page}: ${href}`).toBe(true)
        } else if (href.startsWith(REPO)) {
          const path = href.slice(REPO.length + 1).split('#')[0]!
          expect(existsSync(join(ROOT, path)), `${page}: ${href}`).toBe(true)
        } else if (href.startsWith('/')) {
          const [path, hash] = href.split('#') as [string, string | undefined]
          if (app.has(path)) continue
          const target = fileOf(path)
          expect(files.has(target), `${page}: ${href}`).toBe(true)
          if (hash) expect(ids(target).has(hash), `${page}: ${href}`).toBe(true)
        } else {
          expect(href, page).toMatch(/^https:\/\//)
        }
      }
    }
  })

  it('shows every operation of the OpenAPI document', () => {
    const api = html('docs/api.html')
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const op of Object.values(item)) {
        expect(api, op.operationId).toContain(`id="${operationAnchor(op)}"`)
        expect(api).toContain(`<code>${path}</code>`)
      }
    }
  })

  it('has examples that the schemas accept', () => {
    type Name = keyof typeof openApiSchemas
    const check = (where: string, schema: { $ref?: string, properties?: Record<string, { items?: { $ref?: string } }> }, example: unknown) => {
      const name = (schema.$ref ?? schema.properties?.data?.items?.$ref)?.replace('#/components/schemas/', '') as Name | undefined
      if (!name) throw new Error(`${where}: the test does not know how to check this example. Add its shape here.`)
      // A list: the example has exactly the keys of the schema, and each item parses.
      if (!schema.$ref) expect(Object.keys(example as object).sort(), where).toEqual(Object.keys(schema.properties!).sort())
      const values = schema.$ref ? [example] : (example as { data: unknown[] }).data
      for (const v of values) {
        const result = openApiSchemas[name].safeParse(v)
        expect(result.success, `${where}: ${result.error?.message}`).toBe(true)
      }
    }
    let count = 0
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const op of Object.values(item)) {
        const body = op.requestBody?.content['application/json']
        if (body) { expect(body.example, `${op.operationId} body`).toBeDefined(); check(`${op.operationId} body`, body.schema, body.example); count++ }
        for (const [status, r] of Object.entries(op.responses)) {
          const media = r.content?.['application/json']
          if (media?.example !== undefined) { check(`${path} ${status}`, media.schema, media.example); count++ }
          if (status.startsWith('2') && media) expect(media.example, `${op.operationId} ${status}`).toBeDefined()
        }
      }
    }
    expect(count).toBeGreaterThan(10)

    // Values the schemas allow but the API never sends.
    const all = JSON.stringify(doc)
    expect(all).not.toMatch(/"allowed_actions":\[[^\]]*"read"/)
    for (const [, icon] of all.matchAll(/"icon":"([^"]+)"/g)) expect(TYPE_ICONS.map(i => i.icon), icon).toContain(icon)
  })

  it('states the paging of the list as the code does', () => {
    const list = doc.paths['/api/v1/tickets']!.get!
    const [def, max] = [constant('server/utils/tickets.ts', 'DEFAULT_LIMIT'), constant('server/utils/tickets.ts', 'MAX_LIMIT')]
    expect(list.description).toContain(`${def} by default, at most ${max}`)
    expect(list.parameters!.find(p => p.name === 'limit')!.schema).toMatchObject({ default: def, maximum: max })
  })

  it('states the numbers of the code in the guides', () => {
    const wh = guide('docs/webhooks.md')
    const delays = readFileSync(join(ROOT, 'server/utils/webhooks.ts'), 'utf8').match(/const RETRY_DELAYS = \[(.+)\]/)![1]!
      .split(',').map(e => new Function('MINUTE', 'HOUR', `return ${e}`)(1, 60) as number)
    const label = (min: number) => (min < 60 ? `${min} min` : `${min / 60} h`)
    expect(wh).toContain(`**${delays.slice(0, -1).map(label).join(', ')}**, then every **${label(delays.at(-1)!)}**`)
    expect(wh).toContain(`**${constant('server/utils/webhooks.ts', 'TIMEOUT') / 1000} seconds**`)
    expect(wh).toContain(`**${constant('server/utils/webhooks.ts', 'RETRY_WINDOW') / 3_600_000} hours**`)
    expect(wh).toContain(`**${constant('server/utils/webhooks.ts', 'DISABLE_AFTER') / 86_400_000} days**`)
    expect(wh).toContain(`${constant('server/utils/webhooks.ts', 'KEEP_FOR') / 86_400_000} days`)

    const ai = guide('docs/ai-assistants.md')
    expect(ai).toContain(`| Tool calls | ${constant('server/utils/rate-limit.ts', 'USER_MCP_LIMIT')} a minute`)
    expect(ai).toContain(`| Write tool calls | ${constant('server/utils/rate-limit.ts', 'USER_MCP_WRITE_LIMIT')} a minute`)
    expect(ai).toContain(`| Search page | ${constant('server/utils/mcp.ts', 'PAGE_SIZE')} results, up to ${constant('server/utils/mcp.ts', 'MAX_PAGE_SIZE')}`)
    expect(ai).toContain(`The newest ${constant('server/utils/mcp.ts', 'COMMENT_LIMIT')}`)
    expect(ai).toContain(`up to ${constant('server/utils/attachments.ts', 'MAX_TEXT_BYTES') / 1024} KB`)
    expect(ai).toContain(`One use, ${constant('server/utils/upload-links.ts', 'LINK_TTL_MS') / 60_000} minutes`)
  })

  it('swaps the same example origin that the pages use', () => {
    expect(html('docs/assets/docs.js')).toContain(`const EXAMPLE_ORIGIN = '${EXAMPLE_ORIGIN}'`)
  })

  it('lists exactly the MCP tools and the page tools that the code registers', () => {
    const md = readFileSync(join(ROOT, 'docs/ai-assistants.md'), 'utf8')
    const table = (heading: string) => {
      const section = md.split(/^## /m).find(s => s.startsWith(heading))!
      return [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map(m => m[1]).sort()
    }
    const mcp = [...readFileSync(join(ROOT, 'server/utils/mcp.ts'), 'utf8').matchAll(/registerTool\('([a-z_]+)'/g)].map(m => m[1]).sort()
    const page = [...readFileSync(join(ROOT, 'app/utils/webmcp.ts'), 'utf8').matchAll(/^\s+name: '([a-z_]+)'/gm)].map(m => m[1]).sort()
    expect(mcp.length).toBeGreaterThan(5)
    expect(table('Tools')).toEqual(mcp)
    expect(table('Tools in the page')).toEqual(page)
  })

  it('gives each guide a table of errors and edge cases', () => {
    for (const g of GUIDES) expect(ids(`docs/${g.slug}.html`).has('errors-and-edge-cases'), g.file).toBe(true)
  })

  it('indexes every section for search', () => {
    const entries = JSON.parse(html('docs/search.json')) as SearchEntry[]
    for (const page of PAGES) {
      const path = page === 'docs/index.html' ? '/docs/' : `/${page.replace(/\.html$/, '')}`
      expect(entries.some(e => e.url.startsWith(path)), page).toBe(true)
    }
    for (const e of entries) {
      const [path, hash] = e.url.split('#') as [string, string | undefined]
      if (hash) expect(ids(fileOf(path)).has(hash), e.url).toBe(true)
    }
  })

  it('takes the colors from the web app and fails loudly without them', () => {
    expect(html('docs/assets/docs.css')).toContain('--ui-bg: #ffffff')
    expect(() => appTokens('body { color: red }')).toThrow(/main\.css/)
  })
})
