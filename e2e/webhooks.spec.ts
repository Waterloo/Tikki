import { expect, test } from '@playwright/test'
import { expectToast } from './toast'
import { signInAsAdmin } from './sign-in'

test('an Admin adds an endpoint, sees the secret once, and a failed test event shows as Failing', async ({ browser, baseURL }) => {
  const admin = await (await browser.newContext({ storageState: undefined })).newPage()
  await signInAsAdmin(admin)
  await admin.getByRole('link', { name: 'Webhooks' }).first().click()
  await expect(admin.getByRole('heading', { name: 'Webhooks', level: 1 })).toBeVisible()

  const name = `E2E hook ${Date.now()}`
  await admin.getByRole('button', { name: 'Add endpoint' }).first().click()
  await admin.getByLabel('Name').fill(name)
  // Development allows http://localhost. Nothing answers POST on this path, so the delivery fails.
  await admin.getByLabel('URL').fill(`${baseURL}/nowhere`)
  await expect(admin.getByRole('switch', { name: 'Include internal data' })).not.toBeChecked()
  await admin.getByRole('dialog').getByRole('button', { name: 'Add endpoint' }).click()

  const dialog = admin.getByRole('dialog', { name: 'Signing secret' })
  await expect(dialog.getByLabel('signing secret', { exact: true })).toHaveText(/^whsec_/)
  await dialog.getByRole('button', { name: 'I copied it' }).click()

  const card = admin.getByRole('region', { name })
  await expect(card.getByText('Healthy', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Send test event' }).click()
  await expectToast(admin, 'Test event failed')
  await expect(card.getByText('Failing', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Retry now' })).toBeVisible()

  const log = admin.getByRole('table', { name: `Deliveries · ${name}` })
  await expect(log.getByRole('row').filter({ hasText: 'webhook.test' })).toBeVisible()
  await log.getByRole('button', { name: 'Show' }).first().click()
  await expect(log.getByText('"type": "webhook.test"')).toBeVisible()
})
