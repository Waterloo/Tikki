// Stands in for `cloudflare:workers` while Nitro prerenders the SPA shell in Node at build time.
// The shell never touches these values; they only pass the startup configuration check.
export const env = {
  APP_ENV: 'development',
  APP_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'prerender-only-'.padEnd(32, 'x'),
  ALLOWED_EMAIL_DOMAINS: 'example.com',
  MAIL_TRANSPORT: 'console',
  DB: {},
}

export function waitUntil(): void {}
