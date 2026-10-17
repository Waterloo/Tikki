import { expect, test } from '@playwright/test'

test('choose Bug, see Required errors, fill the Fields, and see the new reference', async ({ page }) => {
  await page.goto('/tickets/new')
  await page.getByRole('button', { name: /^Bug/ }).click()

  const form = page.locator('form')
  const title = form.getByLabel('Title')
  const pageField = form.getByLabel('Page or feature')
  await form.getByRole('button', { name: 'Create ticket' }).click()
  await expect(title).toHaveAccessibleDescription(/required/i)
  await expect(pageField).toHaveAccessibleDescription(/required/i)
  await expect(form.getByText('Required.', { exact: true })).toBeVisible()

  const text = `E2E export fails ${Date.now()}`
  await title.fill(text)
  await pageField.fill('Reports')
  await form.getByRole('combobox', { name: 'How often does it happen?' }).click()
  await page.getByRole('option', { name: 'Every time' }).click()
  await form.getByRole('button', { name: 'High', exact: true }).click()
  await form.getByRole('button', { name: 'Create ticket' }).click()

  const row = page.getByRole('listitem').filter({ hasText: text })
  await expect(row).toBeVisible()
  await expect(row.getByText(/^BUG-\d+$/)).toBeVisible()
})
