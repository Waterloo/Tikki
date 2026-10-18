import { expect, test, type Browser, type Page } from '@playwright/test'
import { ADMIN_STATE, signIn } from './sign-in'

// Issue 43: set-up screens live in a Settings area; the main sidebar shows only daily work.

// The desktop sidebar has no landmark of its own; the page header has a second New ticket button.
const newTicket = (page: Page) => page.locator('[id^="dashboard-sidebar"]').getByRole('link', { name: 'New ticket', exact: true })
const mainLinks = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link')
const settingsEntry = (page: Page) => page.getByRole('link', { name: 'Settings', exact: true })
const settingsMenu = (page: Page) => page.getByRole('navigation', { name: 'Settings' })
const scrollWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth)

async function expectMyTickets(page: Page) {
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'My tickets' }).first()).toBeVisible()
}

async function newAgent(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: undefined })).newPage()
  await signIn(page, email)
  const { user } = await (await page.request.get('/api/auth/get-session')).json() as { user: { id: string } }
  const admin = await browser.newContext({ storageState: ADMIN_STATE })
  const promoted = await admin.request.patch(`/api/v1/users/${user.id}`, { data: { role: 'agent' } })
  expect(promoted.ok(), await promoted.text()).toBe(true)
  await admin.close()
  return page
}

test('a Requester sees New ticket, Inbox and My tickets, and no Settings', async ({ page }) => {
  await page.goto('/')
  await expect(newTicket(page)).toHaveAttribute('href', '/tickets/new')
  await expect(mainLinks(page)).toHaveText([/^Inbox/, 'My tickets'])
  await expect(settingsEntry(page)).toHaveCount(0)
  for (const path of ['/admin', '/settings', '/webhooks']) {
    await page.goto(path)
    await expectMyTickets(page)
    await expect(settingsMenu(page)).toHaveCount(0)
  }
})

test('an Agent sees the staff items and no Settings; Settings URLs send them to My tickets', async ({ browser }) => {
  const page = await newAgent(browser, `e2e-settings-agent-${Date.now()}@example.com`)
  await page.reload()
  await expect(newTicket(page)).toBeVisible()
  await expect(mainLinks(page)).toHaveText([/^Inbox/, 'My tickets', 'Assigned to me', 'All tickets'])
  await expect(settingsEntry(page)).toHaveCount(0)
  for (const path of ['/admin', '/settings', '/admin/types', '/applications']) {
    await page.goto(path)
    await expectMyTickets(page)
    await expect(settingsMenu(page)).toHaveCount(0)
  }
  await page.context().close()
})

test.describe('as the Admin', () => {
  test.use({ storageState: ADMIN_STATE })

  test('the sidebar has the daily items, New ticket, and Settings at the bottom', async ({ page }) => {
    await page.goto('/')
    await expect(newTicket(page)).toBeVisible()
    await expect(mainLinks(page)).toHaveText([/^Inbox/, 'My tickets', 'Assigned to me', 'All tickets'])
    await expect(settingsEntry(page)).not.toHaveAttribute('aria-current')
    await expect(settingsMenu(page)).toHaveCount(0)
    // On a desktop the menu list page is not needed: Settings opens Organization.
    await settingsEntry(page).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(settingsEntry(page)).toHaveAttribute('aria-current', 'page')
  })

  test('each Settings page shows the menu with its item current, and Settings current in the sidebar', async ({ page }) => {
    const types = (await (await page.request.get('/api/v1/ticket-types')).json()).data as { id: number, name: string }[]
    const bug = types.find(t => t.name === 'Bug')!
    const app = await page.request.post('/api/v1/applications', {
      data: { name: `Settings menu ${Date.now()}`, description: 'menu', permissions: ['tickets:read'], ticket_type_ids: [bug.id] },
    })
    expect(app.ok(), await app.text()).toBe(true)
    const { id: appId } = await app.json() as { id: number }

    const pages: [string, string][] = [
      ['/settings', 'Organization'],
      ['/people', 'Teams and users'],
      ['/admin/types', 'Types and fields'],
      [`/admin/types/${bug.id}`, 'Types and fields'],
      ['/admin/types/new', 'Types and fields'],
      ['/applications', 'Applications'],
      [`/applications/${appId}`, 'Applications'],
      ['/webhooks', 'Webhooks'],
      ['/admin/apps', 'Ticket Apps'],
    ]
    for (const [path, item] of pages) {
      await page.goto(path)
      const menu = settingsMenu(page)
      await expect(menu.getByRole('heading')).toHaveText(['General', 'People', 'Tickets', 'Integrations'])
      await expect(menu.locator('[aria-current="page"]'), path).toHaveText(item)
      await expect(settingsEntry(page), path).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current]'), path).toHaveCount(0)
    }

    const docs = settingsMenu(page).getByRole('link', { name: /^Developer docs/ })
    await expect(docs).toHaveAttribute('href', '/docs/')
    await expect(docs).toHaveAttribute('target', '_blank')

    // A menu click moves between Settings pages, keeping the frame.
    await settingsMenu(page).getByRole('link', { name: 'Webhooks', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Webhooks', level: 1 })).toBeVisible()
    await expect(settingsMenu(page).locator('[aria-current="page"]')).toHaveText('Webhooks')

    // Daily-work pages have no Settings menu.
    await page.goto('/tickets')
    await expect(page.getByRole('heading', { name: 'All tickets' }).first()).toBeVisible()
    await expect(settingsMenu(page)).toHaveCount(0)
    await expect(settingsEntry(page)).not.toHaveAttribute('aria-current')
  })

  test('at 375 px Settings opens the menu as a list, an item opens its page, and Back returns to the list', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Settings', exact: true }).click()

    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('banner').getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    await expect(settingsMenu(page)).toHaveCount(1)
    await expect(settingsMenu(page)).toBeVisible()
    expect(await scrollWidth(page)).toBeLessThanOrEqual(375)

    await settingsMenu(page).getByRole('link', { name: 'Webhooks', exact: true }).click()
    await expect(page).toHaveURL(/\/webhooks$/)
    await expect(page.getByRole('banner').getByRole('heading', { name: 'Webhooks', level: 1 })).toBeVisible()
    // The desktop menu panel stays hidden on a phone: only the page shows.
    await expect(settingsMenu(page)).toBeHidden()
    expect(await scrollWidth(page)).toBeLessThanOrEqual(375)

    await page.getByRole('link', { name: 'Back to Settings' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(settingsMenu(page)).toBeVisible()
  })
})
