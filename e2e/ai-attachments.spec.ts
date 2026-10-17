import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { logSize, readCode } from './mail'

const PORT = Number(process.env.E2E_PORT ?? 8799)
const EMAIL = 'e2e-shared@example.com'
// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// Claude makes the link through MCP (covered in the Worker tests). Here the test writes the same row, with the same hash.
async function makeLink(request: APIRequestContext, title: string) {
  const session = await (await request.get('/api/auth/get-session')).json() as { user: { id: string } }
  const types = await (await request.get('/api/v1/ticket-types')).json() as { data: { id: number, name: string }[] }
  const created = await request.post('/api/v1/tickets', { data: { ticket_type_id: types.data.find(t => t.name === 'General request')!.id, title } })
  const ticket = await created.json() as { ref: string, number: number }
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  const now = Date.now()
  const sql = `INSERT INTO upload_link (token_hash, ticket_number, user_id, expires_at, created_at) VALUES ('${hash}', ${ticket.number}, '${session.user.id}', ${now + 15 * 60_000}, ${now})`
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', `.wrangler/e2e-${PORT}`, '--command', sql], { stdio: 'pipe' })
  return { ref: ticket.ref, token }
}

test('open an Upload Link while signed in, upload a PNG, see it on the ticket, and the link works once', async ({ page }) => {
  const { ref, token } = await makeLink(page.request, 'E2E upload link')
  await page.goto(`/upload/${token}`)
  await expect(page.getByRole('heading', { name: 'Upload a file' })).toBeVisible()
  await expect(page.getByText(ref, { exact: false }).first()).toBeVisible()

  await page.locator('input[type=file]').setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByText('The file is on the ticket')).toBeVisible()
  await page.getByRole('link', { name: `Open ${ref}` }).click()
  await expect(page.getByRole('heading', { name: 'E2E upload link' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Attachments' }).getByRole('link', { name: /screen\.png/ })).toBeVisible()

  await page.goto(`/upload/${token}`)
  await expect(page.getByText('This link cannot be used')).toBeVisible()
  await expect(page.getByText('already used')).toBeVisible()
})

test('signed out: sign in, come back to the link, and upload', async ({ browser, page }) => {
  const { ref, token } = await makeLink(page.request, 'E2E link after sign-in')
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const fresh = await context.newPage()
  await fresh.goto(`/upload/${token}`)
  await expect(fresh).toHaveURL(/\/sign-in\?redirect=(%2F|\/)upload(%2F|\/)/)

  await fresh.getByLabel('Work email').fill(EMAIL)
  const from = logSize()
  await fresh.getByRole('button', { name: 'Send code' }).click()
  await fresh.getByLabel('Code').fill(await readCode(EMAIL, from))
  await fresh.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(fresh).toHaveURL(new RegExp(`/upload/${token}$`))
  await fresh.locator('input[type=file]').setInputFiles({ name: 'later.png', mimeType: 'image/png', buffer: PNG })
  await expect(fresh.getByText('The file is on the ticket')).toBeVisible()
  await fresh.getByRole('link', { name: `Open ${ref}` }).click()
  await expect(fresh.getByRole('region', { name: 'Attachments' }).getByRole('link', { name: /later\.png/ })).toBeVisible()
  await context.close()
})
