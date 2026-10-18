import { expect, test, type Page } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

const more = (page: Page) => page.getByRole('button', { name: 'More actions' })
const openCancel = async (page: Page) => {
  await more(page).click()
  await page.getByRole('menuitem', { name: 'Cancel this ticket…' }).click()
}

test('a Requester edits while open, cannot edit later, reopens a resolved ticket, and cancels', async ({ page, browser }) => {
  const types = await page.request.get('/api/v1/ticket-types')
  const general = (await types.json()).data.find((t: { name: string }) => t.name === 'General request')
  const stamp = Date.now()
  const created = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: general.id, title: `E2E self-service ${stamp}`, description: 'First text' } })
  expect(created.ok()).toBe(true)
  const { ref } = await created.json()

  await page.goto(`/tickets/${ref}`)
  // A Requester sees only the actions that are allowed now, and no Status or Priority controls.
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(more(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel ticket' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('textbox', { name: 'Description' }).fill(`Corrected text ${stamp}`)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(`Corrected text ${stamp}`)).toBeVisible()
  await expect(page.getByRole('button', { name: /Latest change:.*edited the description/ })).toBeVisible()

  // The Admin works the ticket in a second session.
  const staff = await browser.newContext({ storageState: undefined })
  const agentPage = await staff.newPage()
  await signInAsAdmin(agentPage)
  const move = (status: string) => agentPage.request.patch(`/api/v1/tickets/${ref}`, { data: { status } })
  expect((await move('in_progress')).ok()).toBe(true)

  await page.reload()
  await expect(page.getByText(`Corrected text ${stamp}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
  await expect(more(page)).toBeVisible()

  expect((await move('resolved')).ok()).toBe(true)
  await page.reload()
  await expect(more(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Reopen', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Latest change:.*reopened this ticket/ })).toBeVisible()

  await openCancel(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel ticket' }).click()
  await expect(page.getByText('Ticket cancelled by requester.')).toBeVisible()
  await expect(more(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toHaveCount(0)
  await staff.close()
})
