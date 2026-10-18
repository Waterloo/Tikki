import { expect, test, type Browser, type Page } from '@playwright/test'
import { signIn, signInAsAdmin } from './sign-in'

/** A new User who signs in, and whom the Admin then makes an Agent. Roles are read on each request. */
async function newAgent(browser: Browser, admin: Page, email: string): Promise<{ page: Page, id: string }> {
  const page = await (await browser.newContext({ storageState: undefined })).newPage()
  await signIn(page, email)
  const { user } = await (await page.request.get('/api/auth/get-session')).json() as { user: { id: string } }
  const promoted = await admin.request.patch(`/api/v1/users/${user.id}`, { data: { role: 'agent' } })
  expect(promoted.ok(), await promoted.text()).toBe(true)
  return { page, id: user.id }
}

test('an Agent raises a data request and adds a second Agent; a third Agent cannot open it', async ({ browser }) => {
  const stamp = Date.now()
  const admin = await (await browser.newContext({ storageState: undefined })).newPage()
  await signInAsAdmin(admin)
  const typeName = `Data export ${stamp}`
  const prefix = `R${String.fromCharCode(65 + (stamp % 26))}${String.fromCharCode(65 + (Math.floor(stamp / 26) % 26))}`
  const made = await admin.request.post('/api/v1/ticket-types', { data: { name: typeName, prefix, description: 'Personal data requests.', visibility: 'participants' } })
  expect(made.ok(), await made.text()).toBe(true)

  // The type list shows the new visibility.
  await admin.goto('/admin/types')
  await expect(admin.getByRole('link').filter({ hasText: typeName }).getByText('Participants only')).toBeVisible()

  const [owner, helper, outsider] = [
    await newAgent(browser, admin, `e2e-owner-${stamp}@example.com`),
    await newAgent(browser, admin, `e2e-helper-${stamp}@example.com`),
    await newAgent(browser, admin, `e2e-outsider-${stamp}@example.com`),
  ]

  const title = `E2E export my records ${stamp}`
  await owner.page.goto('/tickets/new')
  await owner.page.getByRole('button', { name: new RegExp(`^${typeName}`) }).click()
  await owner.page.locator('form').getByLabel('Title').fill(title)
  await owner.page.locator('form').getByRole('button', { name: 'Create ticket' }).click()
  await owner.page.getByRole('listitem').filter({ hasText: title }).getByRole('link').first().click()
  await expect(owner.page.getByRole('heading', { name: title })).toBeVisible()
  const ref = owner.page.url().split('/').pop()!

  const panel = owner.page.getByRole('region', { name: 'Participants' })
  await expect(panel.getByText('Only these people and Admins can see this ticket.')).toBeVisible()
  await panel.getByLabel('Add a Participant').fill(`e2e-helper-${stamp}`)
  await panel.getByRole('button', { name: new RegExp(`e2e-helper-${stamp}`) }).click()
  await expect(owner.page.getByText(`e2e-helper-${stamp}@example.com added`)).toBeVisible()
  await expect(panel.getByRole('button', { name: `Remove e2e-helper-${stamp}@example.com` })).toBeVisible()
  // The Activity shows the change.
  await owner.page.getByRole('tab', { name: 'Activity' }).click()
  await expect(owner.page.getByRole('listitem').filter({ hasText: 'as a Participant' })).toBeVisible()

  await helper.page.goto(`/tickets/${ref}`)
  await expect(helper.page.getByRole('heading', { name: title })).toBeVisible()

  await outsider.page.goto(`/tickets/${ref}`)
  await expect(outsider.page.getByText('No ticket with this reference')).toBeVisible()
  await expect(outsider.page.getByText(title)).toHaveCount(0)
  await outsider.page.goto('/tickets')
  await expect(outsider.page.getByRole('heading', { name: 'All tickets' }).first()).toBeVisible()
  await expect(outsider.page.getByText(title)).toHaveCount(0)
})
