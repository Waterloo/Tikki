import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  nitro: {
    preset: 'cloudflare-module',
    cloudflare: {
      // wrangler.jsonc is the source of truth for bindings and environments.
      deployConfig: false,
      nodeCompat: true,
    },
    // Workers static assets serve the SPA shell, so the Worker never renders HTML.
    prerender: { routes: ['/'] },
    hooks: {
      'prerender:config'(prerenderConfig) {
        prerenderConfig.alias = { ...prerenderConfig.alias, 'cloudflare:workers': fileURLToPath(new URL('./server/prerender/cloudflare-workers.ts', import.meta.url)) }
      },
    },
  },
})
