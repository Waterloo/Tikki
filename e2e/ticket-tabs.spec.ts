import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

test('Conversation is the default tab; Activity holds the changes and Revert; the tab is in the URL', async ({ page, browser }) => {
  const types = await page.request.get('/api/v1/ticket-types')
  const general = (await types.json()).data.find((t: { name: string }) => t.name === 'General request')
  const stamp = Date.now()
  const created = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: general.id, title: `E2E tabs ${stamp}` } })
  const { ref } = await created.json()

  const staff = await browser.newContext({ storageState: undefined })
  const agent = await staff.newPage()
  await signInAsAdmin(agent)
  const patch = (data: object) => agent.request.patch(`/api/v1/tickets/${ref}`, { data })
  const comment = (body: string, visibility: string) => agent.request.post(`/api/v1/tickets/${ref}/comments`, { data: { body, visibility } })
  expect((await comment(`Internal ${stamp}`, 'internal')).ok()).toBe(true)
  expect((await comment(`Public ${stamp}`, 'public')).ok()).toBe(true)
  expect((await patch({ priority: 'urgent' })).ok()).toBe(true)
  expect((await patch({ status: 'in_progress' })).ok()).toBe(true)

  // Conversation: comments and one latest-change line, no other Activity entries.
  await agent.goto(`/tickets/${ref}`)
  const conversationTab = agent.getByRole('tab', { name: 'Conversation' })
  await expect(conversationTab).toHaveAttribute('aria-selected', 'true')
  await expect(agent.getByText(`Internal ${stamp}`)).toBeVisible()
  await expect(agent.getByText(`Public ${stamp}`)).toBeVisible()
  const latest = agent.getByRole('button', { name: /Latest change:.*Status from/ })
  await expect(latest).toBeVisible()
  await expect(agent.getByText('changed priority from Normal to Urgent')).toBeHidden()
  await expect(agent.getByText('created this ticket')).toBeHidden()

  // The latest-change line opens Activity.
  await latest.click()
  await expect(agent).toHaveURL(/\?tab=activity$/)
  await expect(agent.getByText('created this ticket')).toBeVisible()
  const line = agent.getByRole('listitem').filter({ hasText: 'changed priority from Normal to Urgent' })
  await expect(line).toBeVisible()
  await expect(agent.getByText(`Public ${stamp}`)).toBeHidden()

  // Revert works there, and a reload stays on Activity.
  await line.getByRole('button', { name: 'Revert' }).click()
  await expect(agent.getByRole('listitem').filter({ hasText: 'reverted a change: changed priority from Urgent to Normal' })).toBeVisible()
  await agent.reload()
  await expect(agent.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')
  await expect(line).toBeVisible()

  // A link by bare number redirects to the reference and keeps the tab.
  await agent.goto(`/tickets/${ref.split('-')[1]}?tab=activity`)
  await expect(agent).toHaveURL(new RegExp(`/tickets/${ref}\\?tab=activity$`))
  await expect(agent.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')

  // Arrow keys move between tabs, and Conversation drops the query.
  await agent.getByRole('tab', { name: 'Activity' }).focus()
  await agent.keyboard.press('ArrowLeft')
  await expect(conversationTab).toHaveAttribute('aria-selected', 'true')
  await expect(agent).not.toHaveURL(/tab=/)

  // A new comment shows without a reload; a Status change updates the latest-change line.
  await agent.getByLabel(/Only your team sees internal notes/).fill(`Fresh ${stamp}`)
  await agent.getByRole('button', { name: 'Add internal note' }).click()
  await expect(agent.getByText(`Fresh ${stamp}`)).toBeVisible()
  await agent.getByRole('combobox', { name: 'Status' }).click()
  await agent.getByRole('option', { name: 'Resolved' }).click()
  await expect(agent.getByRole('button', { name: /Latest change:.*Status from In progress to Resolved/ })).toBeVisible()

  // An unknown tab opens Conversation.
  await agent.goto(`/tickets/${ref}?tab=nope`)
  await expect(conversationTab).toHaveAttribute('aria-selected', 'true')

  // A Requester sees the same tabs, and no Internal Comments in either.
  await page.goto(`/tickets/${ref}`)
  await expect(page.getByText(`Public ${stamp}`)).toBeVisible()
  await expect(page.getByText(`Internal ${stamp}`)).toHaveCount(0)
  await page.getByRole('tab', { name: 'Activity' }).click()
  await expect(page.getByText('created this ticket')).toBeVisible()
  await expect(page.getByText(`Internal ${stamp}`)).toHaveCount(0)
  await expect(page.getByText(`Fresh ${stamp}`)).toHaveCount(0)
  await staff.close()
})
