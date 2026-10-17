import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 8799)

// The Admin type editor is issue 07, so the test writes a Ticket Type with a file Field into the server's local database.
test.beforeAll(() => {
  const now = Date.now()
  const fields = JSON.stringify([{ key: 'screenshot', label: 'Screenshot', type: 'file', required: false, help: 'A picture of the problem.' }]).replaceAll('\'', '\'\'')
  const sql = [
    `INSERT INTO ticket_type (name, prefix, description, team_id, visible_to_all, created_at) VALUES ('Screenshot request', 'SHOT', 'Needs a picture.', (SELECT id FROM team WHERE name = 'Support'), 0, ${now})`,
    `INSERT INTO schema_version (ticket_type_id, version, fields, created_at) VALUES ((SELECT id FROM ticket_type WHERE prefix = 'SHOT'), 1, '${fields}', ${now})`,
  ].join('; ')
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', `.wrangler/e2e-${PORT}`, '--command', sql], { stdio: 'pipe' })
})

test('upload a file in the New ticket form, create the ticket, and download the file from it', async ({ page }) => {
  await page.goto('/tickets/new')
  await page.getByRole('button', { name: /^Screenshot request/ }).click()
  const form = page.locator('form')
  await form.getByLabel('Title').fill('E2E with a picture')

  await form.locator('input[type=file]').setInputFiles({ name: 'where it broke.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from e2e\n') })
  await expect(form.getByRole('link', { name: /where it broke\.txt/ })).toBeVisible()
  await form.getByRole('button', { name: 'Create ticket' }).click()

  const row = page.getByRole('listitem').filter({ hasText: 'E2E with a picture' })
  await row.getByText(/^SHOT-\d+$/).click()
  await expect(page.getByRole('heading', { name: 'E2E with a picture' })).toBeVisible()

  const details = page.getByRole('region', { name: 'Details' })
  const attachments = page.getByRole('region', { name: 'Attachments' })
  await expect(details.getByRole('link', { name: /where it broke\.txt/ })).toBeVisible()
  await expect(attachments.getByRole('link', { name: /where it broke\.txt/ })).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    attachments.getByRole('link', { name: /where it broke\.txt/ }).click(),
  ])
  expect(download.suggestedFilename()).toBe('where it broke.txt')
  const chunks: Buffer[] = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer)
  expect(Buffer.concat(chunks).toString()).toBe('hello from e2e\n')
})

test('refuse a file above 25 MB in the form, and attach a file on the ticket page', async ({ page }) => {
  const types = await page.request.get('/api/v1/ticket-types')
  const general = (await types.json()).data.find((t: { name: string }) => t.name === 'General request')
  const created = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: general.id, title: 'E2E attach later' } })
  const { ref } = await created.json() as { ref: string }

  await page.goto(`/tickets/${ref}`)
  const attachments = page.getByRole('region', { name: 'Attachments' })
  await expect(attachments.getByText('No attachments yet.')).toBeVisible()

  await attachments.locator('input[type=file]').setInputFiles({ name: 'huge.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(25 * 1024 * 1024 + 1) })
  await expect(page.getByText('The file must be 25 MB or smaller.')).toBeVisible()
  await expect(attachments.getByText('No attachments yet.')).toBeVisible()

  await attachments.locator('input[type=file]').setInputFiles({ name: 'log.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') })
  await expect(attachments.getByRole('link', { name: /log\.csv/ })).toBeVisible()
  await page.reload()
  await expect(attachments.getByRole('link', { name: /log\.csv/ })).toBeVisible()
})
