import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

test('an Agent changes Bug to Payment issue, and the header shows the new reference', async ({ browser, page }) => {
  const stamp = Date.now()
  const types = (await (await page.request.get('/api/v1/ticket-types')).json()).data as { id: number, name: string }[]
  const bug = types.find(t => t.name === 'Bug')!

  // The Admin makes the target type and works the ticket. The shared session is a Requester.
  const staff = await browser.newContext({ storageState: undefined })
  const admin = await staff.newPage()
  await signInAsAdmin(admin)
  const name = `Payment issue ${stamp}`
  const prefix = `P${String.fromCharCode(65 + (stamp % 26))}${String.fromCharCode(65 + (Math.floor(stamp / 26) % 26))}`
  const made = await admin.request.post('/api/v1/ticket-types', { data: { name, prefix, description: 'Money problems.', visibility: 'internal' } })
  expect(made.ok(), await made.text()).toBe(true)

  const created = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: bug.id, title: `E2E wrong type ${stamp}`, fields: { page_or_feature: 'Checkout' } } })
  const { ref, number } = await created.json()

  await admin.goto(`/tickets/${ref}`)
  await expect(admin.getByRole('heading', { name: `E2E wrong type ${stamp}` })).toBeVisible()
  await admin.getByRole('button', { name: 'Change type' }).click()
  await expect(admin.getByText('You cannot revert this.')).toBeVisible()
  await admin.getByRole('combobox', { name: 'New Ticket Type' }).click()
  await admin.getByRole('option', { name, exact: true }).click()
  await admin.getByRole('button', { name: 'Change type' }).click()

  const newRef = `${prefix}-${number}`
  await expect(admin).toHaveURL(new RegExp(`/tickets/${newRef}$`))
  await expect(admin.getByText(newRef, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(admin.getByRole('listitem').filter({ hasText: `from Bug (${ref}) to ${name} (${newRef})` })).toBeVisible()
  await expect(admin.getByText('Did not move: Page or feature')).toBeVisible()

  // The old reference still opens it and moves to the new one.
  await admin.goto(`/tickets/${ref}`)
  await expect(admin).toHaveURL(new RegExp(`/tickets/${newRef}$`))

  // A Requester has no button.
  await page.goto(`/tickets/${newRef}`)
  await expect(page.getByRole('heading', { name: `E2E wrong type ${stamp}` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change type' })).toHaveCount(0)
})
