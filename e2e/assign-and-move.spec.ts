import { expect, test, type Browser, type Page } from '@playwright/test'
import { expectToast } from './toast'
import { signIn, signInAsAdmin } from './sign-in'

/** A new User who signs in, and whom the Admin then makes an Agent. */
async function newAgent(browser: Browser, admin: Page, email: string): Promise<{ page: Page, id: string }> {
  const page = await (await browser.newContext({ storageState: undefined })).newPage()
  await signIn(page, email)
  const { user } = await (await page.request.get('/api/auth/get-session')).json() as { user: { id: string } }
  const promoted = await admin.request.patch(`/api/v1/users/${user.id}`, { data: { role: 'agent' } })
  expect(promoted.ok(), await promoted.text()).toBe(true)
  return { page, id: user.id }
}

test('a Support Agent moves a ticket to Development and assigns it to a Development Agent', async ({ browser, page }) => {
  const stamp = Date.now()
  const admin = await (await browser.newContext({ storageState: undefined })).newPage()
  await signInAsAdmin(admin)
  const devName = `Development ${stamp}`
  const team = await admin.request.post('/api/v1/teams', { data: { name: devName } })
  expect(team.ok(), await team.text()).toBe(true)
  const { id: teamId } = await team.json() as { id: number }

  const support = await newAgent(browser, admin, `e2e-support-${stamp}@example.com`)
  const dev = await newAgent(browser, admin, `e2e-dev-${stamp}@example.com`)
  const added = await admin.request.put(`/api/v1/teams/${teamId}/members/${dev.id}`)
  expect(added.ok(), await added.text()).toBe(true)

  // The shared session is a Requester.
  const types = (await (await page.request.get('/api/v1/ticket-types')).json()).data as { id: number, name: string }[]
  const title = `E2E route me ${stamp}`
  const created = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: types.find(t => t.name === 'Bug')!.id, title, fields: { page_or_feature: 'Checkout' } } })
  const { ref } = await created.json() as { ref: string }

  await support.page.goto(`/tickets/${ref}`)
  await expect(support.page.getByRole('heading', { name: title })).toBeVisible()
  const panel = support.page.getByRole('complementary', { name: 'Ticket properties' })

  // Move to Development. The type's Team is untouched: a second ticket of the type still starts in Support.
  await panel.getByRole('combobox', { name: 'Team' }).click()
  await support.page.getByRole('option', { name: devName }).click()
  await expectToast(support.page, `Moved to ${devName}`)
  await expect(support.page.getByRole('listitem').filter({ hasText: `Support to ${devName}` })).toBeVisible()

  // "Me (you)" is first, then the members of the ticket's Team.
  await panel.getByRole('button', { name: 'Assignee' }).click()
  const options = support.page.getByRole('option')
  await expect(options.first()).toHaveText('Me (you)')
  await expect(options.nth(1)).toContainText(`e2e-dev-${stamp}@example.com`)
  await expect(support.page.getByText(`${devName} members`)).toBeVisible()
  await options.filter({ hasText: `e2e-dev-${stamp}@example.com` }).click()
  await expectToast(support.page, `Assigned to e2e-dev-${stamp}@example.com`)

  // The Development Agent finds it under "Assigned to me", and was told of the move.
  await dev.page.goto('/tickets?filter=mine')
  await expect(dev.page.getByRole('link').filter({ hasText: title })).toBeVisible()
  await dev.page.goto('/inbox')
  await expect(dev.page.getByText(`moved ${ref} to ${devName}`)).toBeVisible()

  // The list filters by the ticket's Team.
  await admin.goto(`/tickets?team=${teamId}`)
  await expect(admin.getByRole('link').filter({ hasText: title })).toBeVisible()
  await admin.goto(`/tickets?team=${teamId + 1000}`)
  await expect(admin.getByRole('link').filter({ hasText: title })).toHaveCount(0)

  // A Requester sees the Team but has no controls.
  await page.goto(`/tickets/${ref}`)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assignee' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Team' })).toHaveCount(0)
})
