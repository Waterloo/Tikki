import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  // Icons are bundled into the client, so the browser never calls the Iconify API and the Worker serves no icon route.
  icon: {
    provider: 'none',
    serverBundle: false,
    // Ticket Type icons come from the database, so the scan cannot find them. These are the seeded ones.
    clientBundle: {
      // The default scan reads no .ts files, so it would miss the icons in app/utils/navigation.ts.
      scan: { globInclude: ['**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}', '**/utils/**/*.ts'] },
      // The set an Admin can choose from (shared/ticket-type-rules.ts).
      icons: ['lucide:bug', 'lucide:credit-card', 'lucide:database', 'lucide:key-round', 'lucide:user', 'lucide:circle-help', 'lucide:life-buoy', 'lucide:ticket'],
    },
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
    // Workers static assets serve the SPA shell, so the Worker never renders HTML.
    prerender: { routes: ['/'] },
    hooks: {
      'prerender:config'(prerenderConfig) {
        // The prerenderer runs on Node, where the Cloudflare entry does not load.
        delete prerenderConfig.entry
        prerenderConfig.alias = { ...prerenderConfig.alias, 'cloudflare:workers': fileURLToPath(new URL('./server/prerender/cloudflare-workers.ts', import.meta.url)) }
      },
    },
  },
})
