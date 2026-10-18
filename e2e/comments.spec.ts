import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

test('an Agent replies in public, the Requester sees it, and an internal note stays hidden', async ({ page, browser }) => {
  const types = await page.request.get('/api/v1/ticket-types')
  const general = (await types.json()).data.find((t: { name: string }) => t.name === 'General request')
  const stamp = Date.now()
  const created = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: general.id, title: `E2E replies ${stamp}` } })
  expect(created.ok()).toBe(true)
  const { ref } = await created.json()

  // The Admin works the ticket in a second browser session.
  const staff = await browser.newContext({ storageState: undefined })
  const agentPage = await staff.newPage()
  await signInAsAdmin(agentPage)
  await agentPage.goto(`/tickets/${ref}`)

  // Internal is the default mode.
  await expect(agentPage.getByRole('button', { name: 'Internal note', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await agentPage.getByLabel(/Only your team sees internal notes/).fill(`Secret note ${stamp}`)
  await agentPage.getByRole('button', { name: 'Add internal note' }).click()
  await expect(agentPage.getByText(`Secret note ${stamp}`)).toBeVisible()

  await agentPage.getByRole('button', { name: 'Public reply', exact: true }).click()
  await agentPage.getByLabel(/sees this reply on the ticket/).fill(`Public answer ${stamp}`)
  await agentPage.getByRole('button', { name: 'Send public reply' }).click()
  await expect(agentPage.getByText(`Public answer ${stamp}`)).toBeVisible()

  // A change appears in the Activity and can be reverted.
  await agentPage.getByRole('combobox', { name: 'Priority' }).click()
  await agentPage.getByRole('option', { name: 'Urgent' }).click()
  await agentPage.getByRole('tab', { name: 'Activity' }).click()
  const line = agentPage.getByRole('listitem').filter({ hasText: 'changed priority from Normal to Urgent' })
  await expect(line).toBeVisible()
  await line.getByRole('button', { name: 'Revert' }).click()
  await expect(agentPage.getByRole('listitem').filter({ hasText: 'reverted a change: changed priority from Urgent to Normal' })).toBeVisible()
  await expect(line.getByRole('button', { name: 'Revert' })).toHaveCount(0)

  // The Requester sees the public reply only.
  await page.goto(`/tickets/${ref}`)
  await expect(page.getByText(`Public answer ${stamp}`)).toBeVisible()
  await expect(page.getByText(`Secret note ${stamp}`)).toHaveCount(0)
  await expect(page.getByText('Internal', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Internal note', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Revert', exact: true })).toHaveCount(0)

  // The Requester replies; the Agent sees it.
  await page.getByLabel('Your team sees this reply.').fill(`Thanks ${stamp}`)
  await page.getByRole('button', { name: 'Send reply', exact: true }).click()
  await expect(page.getByText(`Thanks ${stamp}`)).toBeVisible()
  await agentPage.getByRole('tab', { name: 'Conversation' }).click()
  await expect(agentPage).not.toHaveURL(/tab=/)
  await agentPage.reload()
  await expect(agentPage.getByText(`Thanks ${stamp}`)).toBeVisible()
  await staff.close()
})
