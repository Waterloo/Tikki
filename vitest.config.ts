import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run against the built Worker (.output), so `pnpm test` builds first.

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              main: './.output/server/index.mjs',
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: {
                bindings: {
                  APP_ENV: 'test',
                  APP_URL: 'http://localhost:8787',
                  MAIL_TRANSPORT: 'capture',
                  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
                  ALLOWED_EMAIL_DOMAINS: 'example.com, example.org',
                  ADMIN_EMAIL: 'Admin@Example.com',
                  TEST_MIGRATIONS: migrations,
                },
              },
            }),
          ],
          test: {
            name: 'worker',
            include: ['test/worker/**/*.test.ts'],
            setupFiles: ['./test/worker/apply-migrations.ts'],
          },
        },
        {
          test: {
            name: 'startup',
            include: ['test/startup/**/*.test.ts'],
            environment: 'node',
            testTimeout: 30_000,
          },
        },
      ],
    },
  }
})
