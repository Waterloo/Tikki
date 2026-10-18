import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { siteUrlFrom } from './scripts/docs-site/site-url'

// The public origin, for absolute Open Graph URLs in the docs and the app shell (README, "Developer docs").
const SITE_URL = siteUrlFrom(process.env.DOCS_SITE_URL)
if (!SITE_URL) console.warn('DOCS_SITE_URL is not set: Open Graph URLs are relative, and most sites show no card for them. Set it for a deploy build, for example DOCS_SITE_URL=https://tikki.example.com.')
const SHELL = {
  title: 'Tikki',
  description: 'A small, complete ticketing system for one team. It runs as one Cloudflare Worker.',
  image: '/og/tikki.png',
}

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: SHELL.title,
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
      // The SPA shell is one static page, so a shared link to any page shows this card.
      meta: [
        { name: 'description', content: SHELL.description },
        { property: 'og:site_name', content: 'Tikki' },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: SHELL.title },
        { property: 'og:description', content: SHELL.description },
        ...(SITE_URL ? [{ property: 'og:url', content: `${SITE_URL}/` }] : []),
        { property: 'og:image', content: SITE_URL + SHELL.image },
        { property: 'og:image:width', content: '1280' },
        { property: 'og:image:height', content: '640' },
        { property: 'og:image:alt', content: 'Tikki: a small, complete ticketing system for one team. It runs as one Cloudflare Worker.' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
    },
  },
  // Icons are bundled into the client, so the browser never calls the Iconify API and the Worker serves no icon route.
  icon: {
    provider: 'none',
    serverBundle: false,
    // Ticket Type icons come from the database, so the scan cannot find them. These are the seeded ones.
    clientBundle: {
      // The default scan reads no .ts files, so it would miss the icons in app/utils/navigation.ts.
      scan: { globInclude: ['**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}', '**/utils/**/*.ts'] },
      // The set an Admin can choose from (shared/ticket-type-rules.ts, shared/ticket-app-icons.ts).
      icons: ['lucide:app-window', 'lucide:bug', 'lucide:credit-card', 'lucide:database', 'lucide:key-round', 'lucide:user', 'lucide:circle-help', 'lucide:life-buoy', 'lucide:ticket'],
    },
  },
  routeRules: {
    // Not `immutable`: Vite names a chunk before it writes the CSS file names into it, so a chunk can keep its name
    // while its content changes. A cached old copy then loads the old stylesheet next to the new one. Revalidating
    // costs a 304 from Workers static assets, without the Worker.
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
  },
  nitro: {
    preset: 'cloudflare-module',
    // Puts the upload routes in front of Nitro, which would buffer the body (server/utils/upload.ts).
    entry: fileURLToPath(new URL('./server/entry.ts', import.meta.url)),
    cloudflare: {
      // wrangler.jsonc is the source of truth for bindings and environments.
      deployConfig: false,
      nodeCompat: true,
    },
    virtual: {
      // Built once here: z.toJSONSchema takes about 10 ms, more than the CPU budget of a request (6.2).
      '#openapi-document': async () => {
        // jiti, because Node cannot load the server's TypeScript imports, which have no file extensions.
        const { buildOpenApiDocument } = await createJiti(import.meta.url).import<typeof import('./server/utils/openapi')>('./server/utils/openapi')
        return `export default ${JSON.stringify(JSON.stringify(buildOpenApiDocument()))}`
      },
    },
    // Workers static assets serve the SPA shell, so the Worker never renders HTML.
    prerender: { routes: ['/'] },
    hooks: {
      // The developer docs at /docs: static files made from docs/*.md and the OpenAPI document (docs/writing-docs.md).
      async 'compiled'(nitro) {
        // The prerender build copies these hooks; its output is the same public folder, so once is enough.
        if (nitro.options.preset === 'nitro-prerender' || nitro.options.dev) return
        const jiti = createJiti(import.meta.url)
        const { buildOpenApiDocument } = await jiti.import<typeof import('./server/utils/openapi')>('./server/utils/openapi')
        const { buildDocsSite } = await jiti.import<typeof import('./scripts/docs-site/build')>('./scripts/docs-site/build')
        const root = fileURLToPath(new URL('.', import.meta.url))
        const files = await buildDocsSite(root, buildOpenApiDocument(), { siteUrl: SITE_URL })
        // The card image of the app shell (app.head above): the README cover.
        files.set(SHELL.image.slice(1), readFileSync(join(root, 'docs/assets/readme-cover.png')))
        for (const [path, content] of files) {
          const target = join(nitro.options.output.publicDir, path)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, content)
        }
      },
      'prerender:config'(prerenderConfig) {
        // The prerenderer runs on Node, where the Cloudflare entry does not load.
        delete prerenderConfig.entry
        prerenderConfig.alias = { ...prerenderConfig.alias, 'cloudflare:workers': fileURLToPath(new URL('./server/prerender/cloudflare-workers.ts', import.meta.url)) }
      },
    },
  },
})
