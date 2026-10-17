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

test('typing a title that matches an open bug shows it under the title', async ({ page }) => {
  // Make the bug through the API, with the shared session.
  const word = `zebrafish${Date.now()}`
  const types = await (await page.request.get('/api/v1/ticket-types')).json() as { data: { id: number, prefix: string }[] }
  const bug = types.data.find(t => t.prefix === 'BUG')!
  const created = await page.request.post('/api/v1/tickets', {
    data: { ticket_type_id: bug.id, title: `Exporter ${word} crashes on reports`, fields: { page_or_feature: 'Reports' } },
  })
  expect(created.status()).toBe(201)
  const { ref } = await created.json() as { ref: string }

  await page.goto('/tickets/new')
  await page.getByRole('button', { name: /^Bug/ }).click()
  await page.getByLabel('Title').fill(`${word} exporter crashing`)

  const similar = page.getByRole('region', { name: 'Similar tickets' })
  await expect(similar).toContainText('This may already be reported')
  await expect(similar.getByRole('link', { name: new RegExp(ref) })).toBeVisible()

  await page.getByLabel('Title').fill('nothing like it qqq')
  await expect(similar).toBeHidden()
})
