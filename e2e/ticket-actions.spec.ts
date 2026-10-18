import { expect, test, type Browser, type Page } from '@playwright/test'
import { signIn, signInAsAdmin } from './sign-in'

test.use({ storageState: { cookies: [], origins: [] } })

async function newTicket(page: Page, title: string) {
  const { data } = await (await page.request.get('/api/v1/ticket-types')).json() as { data: { id: number, prefix: string }[] }
  const res = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: data.find(t => t.prefix === 'GEN')!.id, title } })
  expect(res.status()).toBe(201)
  return (await res.json() as { ref: string }).ref
}

async function admin(page: Page) {
  await signInAsAdmin(page)
  return page
}

test('the only page button is Edit; Cancel and Delete are in More actions', async ({ page }) => {
  await admin(page)
  const ref = await newTicket(page, `E2E calm ${Date.now()}`)
  await page.goto(`/tickets/${ref}`)
  const header = page.locator('header')
  await expect(header.getByRole('button')).toHaveCount(2)
  await expect(header.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel ticket' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Cancel this ticket…' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete ticket…' })).toBeVisible()
})

test('edit mode has no Cancel or Delete; Discard leaves the Status alone', async ({ page }) => {
  await admin(page)
  const ref = await newTicket(page, `E2E edit ${Date.now()}`)
  await page.goto(`/tickets/${ref}`)
  const status = page.getByRole('combobox', { name: 'Status' })
  const before = await status.innerText()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Cancel|Delete/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(status).toHaveText(before)
})

test('cancelling needs the menu item and the dialog button; Keep ticket changes nothing', async ({ page }) => {
  await admin(page)
  const ref = await newTicket(page, `E2E cancel ${Date.now()}`)
  await page.goto(`/tickets/${ref}`)
  const status = page.getByRole('combobox', { name: 'Status' })
  const before = await status.innerText()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Cancel this ticket…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cancel this ticket?' })
  await dialog.getByRole('button', { name: 'Keep ticket' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(status).toHaveText(before)
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Cancel this ticket…' }).click()
  await dialog.getByRole('button', { name: 'Cancel ticket' }).click()
  await expect(page.getByText('Ticket cancelled', { exact: true })).toBeVisible()
  await expect(status).toHaveText(/Closed/)
})

test('an Admin deletes a ticket and Undo in the toast restores it', async ({ page }) => {
  await admin(page)
  const title = `E2E undo ${Date.now()}`
  const ref = await newTicket(page, title)
  await page.goto(`/tickets/${ref}`)
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete ticket…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete ticket' }).click()
  await expect(page).toHaveURL(/\/tickets$/)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText(`${ref} restored`, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/tickets/${ref}$`))
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
})

async function newAgent(browser: Browser, adminPage: Page, email: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: undefined })).newPage()
  await signIn(page, email)
  const { user } = await (await page.request.get('/api/auth/get-session')).json() as { user: { id: string } }
  expect((await adminPage.request.patch(`/api/v1/users/${user.id}`, { data: { role: 'agent' } })).ok()).toBe(true)
  return page
}

test('an Agent assigns themself from the select and from the small link', async ({ browser, page }) => {
  await admin(page)
  const stamp = Date.now()
  const agent = await newAgent(browser, page, `e2e-self-${stamp}@example.com`)
  const first = await newTicket(page, `E2E me select ${stamp}`)
  const second = await newTicket(page, `E2E me link ${stamp}`)

  await agent.goto(`/tickets/${first}`)
  const panel = agent.getByRole('complementary', { name: 'Ticket properties' })
  await panel.getByRole('button', { name: 'Assignee' }).click()
  await expect(agent.getByRole('option').first()).toHaveText('Me (you)')
  await agent.getByRole('option', { name: 'Me (you)' }).click()
  await expect(agent.getByText('Assigned to you', { exact: true })).toBeVisible()
  // Assigned: the link is gone, and "Nobody" unassigns.
  await expect(panel.getByRole('button', { name: 'Assign to me' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Assignee' }).click()
  await agent.getByRole('option', { name: 'Nobody' }).click()
  await expect(agent.getByText('Unassigned', { exact: true }).first()).toBeVisible()

  await agent.goto(`/tickets/${second}`)
  await panel.getByRole('button', { name: 'Assign to me' }).click()
  await expect(agent.getByText('Assigned to you', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Assign to me' })).toHaveCount(0)
})
