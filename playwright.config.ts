import { defineConfig, devices } from '@playwright/test'

const PORT = 8799
const STATE = '.wrangler/e2e'

export default defineConfig({
  testDir: 'e2e',
  // One database and one ticket counter are shared, so tests run one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // Fresh state on each run. The secret is fixed here, because CI has no .dev.vars.
    // The server output goes to a file: e2e/mail.ts reads the sign-in codes from it.
    command: [
      `rm -rf ${STATE} e2e/.server.log`,
      'pnpm exec nuxt build',
      `pnpm exec wrangler d1 migrations apply DB --local --persist-to ${STATE}`,
      `pnpm exec wrangler dev --port ${PORT} --var APP_URL:http://localhost:${PORT} --var BETTER_AUTH_SECRET:e2e-secret-e2e-secret-e2e-secret-00 --persist-to ${STATE} > e2e/.server.log 2>&1`,
    ].join(' && '),
    env: { NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
    url: `http://localhost:${PORT}/sign-in`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
})
