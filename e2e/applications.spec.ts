import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

// The Admin is a different User from the shared session, so this test signs in on its own.
test.use({ storageState: { cookies: [], origins: [] } })

test('an Admin creates an Application and a key, the key works, and Revoke stops it', async ({ page, request }) => {
  await signInAsAdmin(page)
  await page.getByRole('link', { name: 'Applications' }).click()

  const name = `Checkout ${Date.now()}`
  await page.getByRole('button', { name: 'New application' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Allowed ticket types' }).click()
  await page.getByRole('option', { name: 'General request' }).click()
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'Create application' }).click()

  await expect(page.getByRole('heading', { name, level: 2, exact: true })).toBeVisible()
  await expect(page.getByText('General request', { exact: true })).toBeVisible()

  await expect(page.getByText('60 requests a minute, 10 of them creates')).toBeVisible()
  await page.getByRole('button', { name: 'Change' }).click()
  const limits = page.getByRole('dialog')
  await limits.getByLabel('Requests a minute').fill('30')
  await limits.getByLabel('Ticket creates a minute').fill('50')
  await limits.getByRole('button', { name: 'Save' }).click()
  await expect(limits.getByText('cannot be more than the request limit')).toBeVisible()
  await limits.getByLabel('Ticket creates a minute').fill('5')
  await limits.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('30 requests a minute, 5 of them creates')).toBeVisible()
  await page.reload()
  await expect(page.getByText('30 requests a minute, 5 of them creates')).toBeVisible()

  await page.getByRole('button', { name: 'Create key' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click()
  const notice = page.getByRole('status').filter({ hasText: 'Key created. Copy it now.' })
  await expect(notice).toBeVisible()
  const key = (await notice.locator('code').textContent())!.trim()
  expect(key).toMatch(/^gt_live_[0-9a-f]{64}$/)

  const types = await (await request.get('/api/v1/ticket-types', { headers: { authorization: `Bearer ${key}` } })).json() as { data: { id: number }[] }
  const ticket = { ticket_type_id: types.data[0]!.id, title: 'Card declined', contact: { external_id: 'cus_1', name: 'Ana', email: 'ana@shop.example' } }
  const created = await request.post('/api/v1/tickets', { data: ticket, headers: { authorization: `Bearer ${key}` } })
  expect(created.status()).toBe(201)

  // Done hides the key for good. The list shows only its first characters.
  await notice.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText(key)).toHaveCount(0)
  await expect(page.getByText(`${key.slice(0, 12)}…`)).toBeVisible()

  await page.getByRole('button', { name: 'Revoke' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke key' }).click()
  await expect(page.getByText('No keys. Create one')).toBeVisible()
  expect((await request.post('/api/v1/tickets', { data: ticket, headers: { authorization: `Bearer ${key}` } })).status()).toBe(401)

  await page.getByRole('button', { name: 'Disable application' }).click()
  await expect(page.getByText('Disabled', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable application' })).toBeVisible()
})
