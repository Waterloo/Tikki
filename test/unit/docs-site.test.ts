import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { appTokens, buildDocsSite, GUIDES, type SearchEntry } from '../../scripts/docs-site/build'
import { operationAnchor, type OpenApiDocument } from '../../scripts/docs-site/api'
import { REPO } from '../../scripts/docs-site/markdown'
import { buildOpenApiDocument, openApiSchemas } from '../../server/utils/openapi'

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
    const check = (where: string, schema: { $ref?: string, properties?: { data?: { items?: { $ref?: string } } } }, example: unknown) => {
      const name = (schema.$ref ?? schema.properties?.data?.items?.$ref)?.replace('#/components/schemas/', '') as Name | undefined
      if (!name) throw new Error(`${where}: the test does not know how to check this example. Add its shape here.`)
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
