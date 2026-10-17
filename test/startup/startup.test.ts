import { globSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import { describe, expect, it } from 'vitest'

const valid = {
  APP_ENV: 'development',
  APP_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'startup-test-secret-of-32-characters',
  ALLOWED_EMAIL_DOMAINS: 'example.com',
  MAIL_TRANSPORT: 'console',
}

/** Starts the built Worker in workerd with these variables. Returns the startup error, or the status of one request. */
async function start(bindings: Record<string, string>): Promise<{ error: string } | { status: number }> {
  const mf = new Miniflare({
    // The entry module must come first; Nitro chunks are loaded with dynamic imports.
    modules: ['.output/server/index.mjs', ...globSync('.output/server/chunks/**/*.mjs')].map(path => ({ type: 'ESModule' as const, path })),
    // The newest date this Miniflare's workerd supports; the configuration check does not depend on it.
    compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat'],
    bindings,
    d1Databases: ['DB'],
  })
  try {
    await mf.ready
    const res = await mf.dispatchFetch('http://localhost:8787/api/v1/tickets')
    return { status: res.status }
  } catch (error) {
    return { error: (error as Error).message }
  } finally {
    await mf.dispose().catch(() => {})
  }
}

describe('startup configuration check', () => {
  it('starts with a valid development configuration', async () => {
    expect(await start(valid)).toEqual({ status: 401 })
  })

  it('refuses to start when ALLOWED_EMAIL_DOMAINS is missing', async () => {
    const { ALLOWED_EMAIL_DOMAINS: _, ...rest } = valid
    expect(await start(rest)).toEqual({ error: expect.stringContaining('ALLOWED_EMAIL_DOMAINS is required') })
    expect(await start({ ...valid, ALLOWED_EMAIL_DOMAINS: ' , ' })).toEqual({ error: expect.stringContaining('ALLOWED_EMAIL_DOMAINS is required') })
  })

  it('refuses to start with the console transport outside development', async () => {
    for (const APP_ENV of ['staging', 'production', 'test']) {
      expect(await start({ ...valid, APP_ENV }), APP_ENV).toEqual({ error: expect.stringContaining('MAIL_TRANSPORT=console is allowed only when APP_ENV=development') })
    }
  })

  it('refuses to start with the capture transport outside tests', async () => {
    expect(await start({ ...valid, MAIL_TRANSPORT: 'capture' })).toEqual({ error: expect.stringContaining('MAIL_TRANSPORT=capture is allowed only when APP_ENV=test') })
  })
})
