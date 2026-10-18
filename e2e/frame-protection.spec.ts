import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 8799)

// Static pages come from Workers static assets (`_headers`), the rest from the Worker. The Workers test runtime
// serves no static assets, so this runs against wrangler dev.
for (const path of ['/', '/tickets/X', '/consent', '/upload/x', '/sign-in', '/api/v1/tickets', '/mcp', '/.well-known/oauth-authorization-server']) {
  test(`no framing header set on ${path}`, async ({ request }) => {
    const response = await request.get(path, { failOnStatusCode: false, maxRedirects: 0 })
    expect(response.headers()['content-security-policy']).toBe("frame-ancestors 'none'")
    expect(response.headers()['x-frame-options']).toBe('DENY')
  })
}

test('an upload response has the framing headers', async ({ request }) => {
  const response = await request.put('/api/v1/attachments', { data: 'x', failOnStatusCode: false })
  expect(response.headers()['content-security-policy']).toBe("frame-ancestors 'none'")
  expect(response.headers()['x-frame-options']).toBe('DENY')
})

test('a page on another origin cannot frame the app', async ({ page }) => {
  const framer = createServer((_, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<iframe id="f" src="http://localhost:${PORT}/"></iframe>`)
  })
  await new Promise<void>((resolve) => framer.listen(0, resolve))
  try {
    const { port } = framer.address() as { port: number }
    await page.goto(`http://127.0.0.1:${port}/`)
    const iframe = await page.waitForSelector('#f')
    // Chromium puts a blocked frame on its error page.
    await expect.poll(() => iframe.contentFrame().then((f) => f?.url())).toContain('chrome-error://')
  } finally {
    framer.close()
  }
})
