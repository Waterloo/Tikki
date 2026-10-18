import { defineConfig, devices } from '@playwright/test'

// Parallel worktrees set E2E_PORT so their servers do not collide.
const PORT = Number(process.env.E2E_PORT ?? 8799)
const STATE = `.wrangler/e2e-${PORT}`

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
  webServer: [{
    // RATE_LIMITS:off keeps the many fast requests of the suite from hitting the limits (allowed only in development and test).
    // Fresh state on each run. The secret is fixed here, because CI has no .dev.vars.
    // The server output goes to a file: e2e/mail.ts reads the sign-in codes from it.
    command: [
      `rm -rf ${STATE} e2e/.server.log`,
      'pnpm exec nuxt build',
      `pnpm exec wrangler d1 migrations apply DB --local --persist-to ${STATE}`,
      `pnpm exec wrangler dev --port ${PORT} --var APP_URL:http://localhost:${PORT} --var BETTER_AUTH_SECRET:e2e-secret-e2e-secret-e2e-secret-00 --var RATE_LIMITS:off --persist-to ${STATE} > e2e/.server.log 2>&1`,
    ].join(' && '),
    env: { NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
    url: `http://localhost:${PORT}/sign-in`,
    timeout: 300_000,
    reuseExistingServer: false,
  }, {
    // The test Ticket App, on another origin (e2e/ticket-app.ts).
    command: 'node e2e/ticket-app-server.mjs',
    url: `http://localhost:${Number(process.env.E2E_APP_PORT ?? PORT + 100)}/health`,
    reuseExistingServer: false,
  }],
})
