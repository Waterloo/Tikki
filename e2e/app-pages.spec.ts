import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { ADMIN_STATE, signInAsAdmin } from './sign-in'
import { APP_ORIGIN, appFrame, appUrl, contexts } from './ticket-app'

// Issue 39: app pages in the Apps menu of the main sidebar.

let admin: APIRequestContext
const created: number[] = []

test.beforeAll(async ({ playwright, baseURL }) => {
  admin = await playwright.request.newContext({ baseURL, storageState: ADMIN_STATE })
})
// Page apps show in every sidebar, so none stays for the other specs.
test.afterAll(async () => {
  for (const id of created) await admin.delete(`/api/v1/admin/ticket-apps/${id}`)
  await admin.dispose()
})

async function addApp(body: Record<string, unknown>): Promise<{ id: number, name: string }> {
  const res = await admin.post('/api/v1/admin/ticket-apps', { data: body })
  expect(res.status(), await res.text()).toBe(201)
  const app = await res.json() as { id: number, name: string }
  created.push(app.id)
  return app
}

async function raise(title: string): Promise<string> {
  const types = (await (await admin.get('/api/v1/ticket-types')).json()).data as { id: number, name: string }[]
  const res = await admin.post('/api/v1/tickets', { data: { ticket_type_id: types.find(t => t.name === 'General request')!.id, title } })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()).ref
}

const appsMenu = (page: Page) => page.getByRole('navigation', { name: 'Apps', exact: true })
const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
const navigate = (page: Page, name: string, path: string, origin: string) =>
  page.frameLocator(`iframe[title="${name}"]`).locator('body').evaluate((_, [p, o]) => window.parent.postMessage({ type: 'tikki:navigate', path: p }, o!), [path, origin])

test('the Apps section lists a page app, and its page loads with placement=page and a context without a ticket', async ({ browser, baseURL }) => {
  const stamp = Date.now()
  const app = await addApp({ name: `Timesheet ${stamp}`, page_url: appUrl(baseURL!, 'normal', '&view=week') })
  // An app without a page URL is not in the menu.
  const card = await addApp({ name: `Card only ${stamp}`, sidebar_url: appUrl(baseURL!) })
  const context = await browser.newContext({ storageState: undefined, colorScheme: 'dark' })
  const page = await context.newPage()
  await signInAsAdmin(page)

  const menu = appsMenu(page)
  await expect(menu.getByRole('link', { name: app.name, exact: true })).toBeVisible()
  await expect(menu.getByRole('link', { name: card.name, exact: true })).toHaveCount(0)
  await menu.getByRole('link', { name: app.name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/apps/${app.id}$`))
  await expect(page.getByRole('heading', { level: 1, name: app.name })).toBeVisible()
  await expect(menu.getByRole('link', { name: app.name, exact: true })).toHaveAttribute('aria-current', 'page')

  const iframe = page.locator(`iframe[title="${app.name}"]`)
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox')
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(await iframe.getAttribute('allow')).toBeNull()
  const frame = await appFrame(page, app.name, 'page')
  const url = new URL(frame.url())
  expect(url.origin).toBe(APP_ORIGIN)
  expect(url.searchParams.get('view')).toBe('week')
  expect(url.searchParams.get('placement')).toBe('page')

  const [first] = await contexts(frame)
  expect(first!.theme).toBe('dark')
  expect(first!.data).toMatchObject({ version: 1, app: { id: app.id, name: app.name, placement: 'page' }, user: { role: 'admin' } })
  expect(first!.data).not.toHaveProperty('ticket')
  expect(first!.data).not.toHaveProperty('requester')
  expect(claims(first!.token)).toMatchObject({ aud: APP_ORIGIN, tikki_app: app.id, tikki_placement: 'page', tikki_role: 'admin' })
  expect(claims(first!.token)).not.toHaveProperty('tikki_ticket')

  // The frame fills the main area under the header: no card around it.
  const box = (await iframe.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 2)
  expect(box.height).toBeGreaterThan(viewport.height - 120)
  await context.close()
})

test('tikki:navigate opens a ticket or an app page, from a page and from a sidebar card; other paths are ignored', async ({ browser, baseURL }) => {
  const stamp = Date.now()
  const app = await addApp({ name: `Timesheet ${stamp}`, page_url: appUrl(baseURL!) })
  const card = await addApp({ name: `Linker ${stamp}`, sidebar_url: appUrl(baseURL!) })
  const ref = await raise(`Navigate here ${stamp}`)
  const other = await raise(`And then here ${stamp}`)
  const context = await browser.newContext({ storageState: undefined })
  const page = await context.newPage()
  await signInAsAdmin(page)
  await page.goto(`/apps/${app.id}`)
  await appFrame(page, app.name, 'page')

  for (const path of ['https://evil.test/', '//evil.test', '/sign-out', '/tickets/%2e%2e/sign-out', '/\\evil.test', 42]) {
    await navigate(page, app.name, path as string, baseURL!)
  }
  await page.waitForTimeout(1000)
  await expect(page).toHaveURL(new RegExp(`/apps/${app.id}$`))
  await expect(page.getByRole('heading', { level: 1, name: app.name })).toBeVisible()

  await navigate(page, app.name, `/tickets/${ref}`, baseURL!)
  await expect(page).toHaveURL(new RegExp(`/tickets/${ref}$`))
  await expect(page.getByRole('heading', { name: `Navigate here ${stamp}` })).toBeVisible()

  // A sidebar app can link to another ticket too.
  await appFrame(page, card.name, 'sidebar')
  await navigate(page, card.name, `/tickets/${other}`, baseURL!)
  await expect(page).toHaveURL(new RegExp(`/tickets/${other}$`))
  await expect(page.getByRole('heading', { name: `And then here ${stamp}` })).toBeVisible()
  await context.close()
})

test('a Requester sees no Apps section until "Show the page to Requesters" is on, then sees only that app', async ({ page, baseURL }) => {
  const stamp = Date.now()
  // The default context is the shared Requester.
  const staffOnly = await addApp({ name: `Staff page ${stamp}`, page_url: appUrl(baseURL!) })
  const shared = await addApp({ name: `Help center ${stamp}`, page_url: appUrl(baseURL!, 'normal', '&app=shared') })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My tickets' }).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(appsMenu(page)).toHaveCount(0)
  await page.goto(`/apps/${staffOnly.id}`)
  await expect(page.getByText('No app page here', { exact: true })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)

  // The admin form: the switch is on only with a page URL.
  const adminContext = await page.context().browser()!.newContext({ storageState: undefined })
  const adminPage = await adminContext.newPage()
  await signInAsAdmin(adminPage)
  await adminPage.goto('/admin/apps')
  const row = adminPage.getByRole('region', { name: shared.name, exact: true })
  await expect(row.getByText('Page', { exact: true })).toBeVisible()
  await expect(row.getByText('Requesters', { exact: true })).toHaveCount(0)
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = adminPage.getByRole('dialog')
  const toggle = dialog.getByRole('switch', { name: 'Show the page to Requesters' })
  await expect(toggle).toBeEnabled()
  await dialog.getByLabel('Page URL').fill('')
  await expect(toggle).toBeDisabled()
  await dialog.getByLabel('Page URL').fill(appUrl(baseURL!, 'normal', '&app=shared'))
  await toggle.click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(row.getByText('Requesters', { exact: true })).toBeVisible()
  await adminContext.close()

  await page.goto('/')
  const menu = appsMenu(page)
  await expect(menu.getByRole('link')).toHaveCount(1)
  await expect(menu.getByRole('link', { name: shared.name, exact: true })).toBeVisible()
  await menu.getByRole('link', { name: shared.name, exact: true }).click()
  const frame = await appFrame(page, shared.name, 'page')
  const [first] = await contexts(frame)
  expect(first!.data).toMatchObject({ app: { id: shared.id, placement: 'page' }, user: { role: 'requester' } })
  expect(claims(first!.token)).toMatchObject({ tikki_placement: 'page', tikki_role: 'requester' })
  // The staff page stays hidden, also by its URL.
  await page.goto(`/apps/${staffOnly.id}`)
  await expect(page.getByText('No app page here', { exact: true })).toBeVisible()
  expect((await page.request.post(`/api/v1/apps/${staffOnly.id}/token`)).status()).toBe(404)
})
