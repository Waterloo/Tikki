import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

test('an Admin adds the webhook of an Application, sees the secret once, and a failed test event shows as Failing', async ({ page }) => {
  await signInAsAdmin(page)
  await page.getByRole('link', { name: 'Applications' }).click()

  const name = `Hooked ${Date.now()}`
  await page.getByRole('button', { name: 'New application' }).first().click()
  await page.getByRole('dialog').getByLabel('Name').fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Create application' }).click()
  await expect(page.getByRole('heading', { name, level: 2, exact: true })).toBeVisible()

  const hook = page.getByRole('region', { name: `Webhook to ${name}` })
  await expect(hook.getByText('No webhook yet')).toBeVisible()
  // Development allows http://localhost. Nothing answers POST on this path, so the delivery fails.
  await hook.getByLabel('URL').fill(`${new URL(page.url()).origin}/nowhere`)
  await hook.getByRole('button', { name: 'Add webhook' }).click()

  const dialog = page.getByRole('dialog', { name: 'Signing secret' })
  await expect(dialog.getByLabel('signing secret', { exact: true })).toHaveText(/^whsec_/)
  await dialog.getByRole('button', { name: 'I copied it' }).click()

  await expect(hook.getByText('Healthy', { exact: true })).toBeVisible()
  await expect(hook.getByText('ticket.created', { exact: true })).toBeVisible()
  await expect(hook.getByText('comment.created', { exact: true })).toBeVisible()
  await hook.getByRole('button', { name: 'Send test event' }).click()
  await expect(page.getByText('Test event failed', { exact: true })).toBeVisible()
  await expect(hook.getByText('Failing', { exact: true })).toBeVisible()
  await expect(hook.getByRole('button', { name: 'Retry now' })).toBeVisible()
  await expect(hook.getByText('Test event', { exact: true })).toBeVisible()

  await hook.getByRole('button', { name: 'Rotate' }).click()
  await page.getByRole('button', { name: 'Rotate secret' }).click()
  await expect(page.getByRole('dialog', { name: 'Signing secret' })).toBeVisible()
})
