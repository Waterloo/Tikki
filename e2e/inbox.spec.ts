import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { signIn, signInAsAdmin } from './sign-in'

const PORT = Number(process.env.E2E_PORT ?? 8799)

// Role changes come with issue 20, so the test promotes the User in the local database of the e2e server.
function promote(email: string, role: 'agent') {
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', `.wrangler/e2e-${PORT}`, '--command', `UPDATE user SET role = '${role}' WHERE email = '${email}'`], { stdio: 'pipe' })
}

test('an Agent assigns a ticket; the assignee sees the notice and opens the ticket from it', async ({ page, browser }) => {
  const stamp = Date.now()
  const assigneeEmail = `e2e-assignee-${stamp}@example.com`

  // The assignee signs in once to exist, becomes an Agent, then signs in again with the new role.
  const first = await browser.newContext({ storageState: undefined })
  await signIn(await first.newPage(), assigneeEmail)
  await first.close()
  promote(assigneeEmail, 'agent')
  const agentContext = await browser.newContext({ storageState: undefined })
  const agentPage = await agentContext.newPage()
  await signIn(agentPage, assigneeEmail)
  const me = await (await agentPage.request.get('/api/auth/get-session')).json()

  const types = await page.request.get('/api/v1/ticket-types')
  const general = (await types.json()).data.find((t: { name: string }) => t.name === 'General request')
  const created = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: general.id, title: `E2E inbox ${stamp}` } })
  expect(created.ok()).toBe(true)
  const { ref } = await created.json()

  // The Admin assigns it.
  const adminContext = await browser.newContext({ storageState: undefined })
  const adminPage = await adminContext.newPage()
  await signInAsAdmin(adminPage)
  const assigned = await adminPage.request.patch(`/api/v1/tickets/${ref}`, { data: { assignee_id: me.user.id } })
  expect(assigned.ok()).toBe(true)

  await agentPage.goto('/inbox')
  await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
  const notice = agentPage.getByRole('link', { name: new RegExp(`assigned ${ref} to you`) })
  await expect(notice).toBeVisible()
  await expect(notice.getByRole('img', { name: 'Unread' })).toBeVisible()
  await expect(agentPage.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Inbox/ })).toContainText(/\d/)

  await notice.click()
  await expect(agentPage).toHaveURL(new RegExp(`/tickets/${ref}$`))
  await expect(agentPage.getByRole('heading', { name: `E2E inbox ${stamp}` })).toBeVisible()

  // Opening it marked it read; "Mark all as read" clears the rest, and the empty state shows in Unread.
  await agentPage.goto('/inbox')
  await expect(agentPage.getByRole('link', { name: new RegExp(`assigned ${ref} to you`) }).getByRole('img', { name: 'Unread' })).toHaveCount(0)
  await agentPage.getByRole('button', { name: 'Mark all as read' }).click()
  await agentPage.getByRole('button', { name: /^Unread/ }).click()
  await expect(agentPage.getByText('You are up to date')).toBeVisible()

  // "Assigned to me" is always on.
  await expect(agentPage.getByRole('switch', { name: /A ticket is assigned to me/ })).toBeDisabled()
  await expect(agentPage.getByRole('switch', { name: /A ticket is assigned to me/ })).toBeChecked()

  await adminContext.close()
  await agentContext.close()
})
