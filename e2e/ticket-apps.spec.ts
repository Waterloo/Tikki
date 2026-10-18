import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { ADMIN_STATE, signInAsAdmin } from './sign-in'
import { APP_ORIGIN, appFrame, appUrl, contexts } from './ticket-app'

interface Type { id: number, name: string }

let admin: APIRequestContext
const created: number[] = []
let stamp = Date.now()

test.beforeAll(async ({ playwright, baseURL }) => {
  admin = await playwright.request.newContext({ baseURL, storageState: ADMIN_STATE })
})
// Apps show on every ticket of their types, so none stays for the other specs.
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

async function types(): Promise<Record<string, Type>> {
  const data = (await (await admin.get('/api/v1/ticket-types')).json()).data as Type[]
  return Object.fromEntries(data.map(t => [t.name, t]))
}

async function raise(api: APIRequestContext, type: Type, title: string): Promise<string> {
  const fields = type.name === 'Bug' ? { page_or_feature: 'Checkout' } : {}
  const res = await api.post('/api/v1/tickets', { data: { ticket_type_id: type.id, title, fields } })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()).ref
}

async function staffPage(page: Page) {
  await signInAsAdmin(page)
  return page
}

const frameHeight = (page: Page, name: string) => page.locator(`iframe[title="${name}"]`).evaluate(el => el.getBoundingClientRect().height)

test('a sidebar app gets the context from its own origin only, and resizes within the limits', async ({ browser, baseURL }) => {
  stamp = Date.now()
  const { 'General request': general } = await types()
  const app = await addApp({ name: `Orders ${stamp}`, url: appUrl(baseURL!), position: 'sidebar' })
  // Same origin as Orders: only the event source tells their messages apart.
  const twin = await addApp({ name: `Refunds ${stamp}`, url: appUrl(baseURL!, 'normal', '&app=twin'), position: 'sidebar' })
  const ref = await raise(admin, general!, `Charged twice ${stamp}`)

  const context = await browser.newContext({ storageState: undefined, colorScheme: 'dark' })
  const page = await staffPage(await context.newPage())
  await page.goto(`/tickets/${ref}`)
  const card = page.getByRole('region', { name: app.name })
  await expect(card).toBeVisible()
  const iframe = card.locator('iframe')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox')
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(await frameHeight(page, app.name)).toBe(200)

  const frame = await appFrame(page, app.name)
  await expect(frame.locator('#ref')).toHaveText(ref)
  const [first] = await contexts(frame)
  expect(first!.theme).toBe('dark')
  expect(first!.data).toMatchObject({ version: 1, app: { id: app.id, position: 'sidebar' }, ticket: { ref, ticket_type: { id: general!.id } }, requester: { kind: 'user' } })
  expect(first!.data).not.toHaveProperty('comments')
  const claims = JSON.parse(Buffer.from(first!.token.split('.')[1]!, 'base64url').toString())
  expect(claims).toMatchObject({ aud: APP_ORIGIN, tikki_ticket: ref, tikki_scope: 'read', tikki_app: app.id })

  // Resize, clamped to 120..600.
  const resize = (height: number) => frame.evaluate(([h, origin]) => window.parent.postMessage({ type: 'tikki:resize', height: h }, origin as string), [height, baseURL!] as const)
  await resize(50)
  await expect.poll(() => frameHeight(page, app.name)).toBe(120)
  await resize(5000)
  await expect.poll(() => frameHeight(page, app.name)).toBe(600)
  await resize(260)
  await expect.poll(() => frameHeight(page, app.name)).toBe(260)
  await appFrame(page, twin.name)
  expect(await frameHeight(page, twin.name)).toBe(200)

  // The ticket changes: the app gets a new context.
  const before = (await contexts(frame)).length
  await page.getByRole('combobox', { name: 'Priority' }).click()
  await page.getByRole('option', { name: 'Urgent' }).click()
  await expect.poll(async () => (await contexts(frame)).at(-1)?.data.ticket.priority).toBe('urgent')
  expect((await contexts(frame)).length).toBeGreaterThan(before)

  // Collapse keeps the app loaded.
  await card.getByRole('button', { name: `Collapse ${app.name}` }).click()
  await expect(iframe).toBeHidden()
  await card.getByRole('button', { name: `Expand ${app.name}` }).click()
  await expect(frame.locator('#ref')).toHaveText(ref)

  // The same frame now shows a page on another origin. Tikki ignores its messages and sends it nothing.
  const hostile = appUrl(baseURL!, 'normal').replace('localhost', '127.0.0.1').replace('mode=normal', 'mode=hostile')
  await frame.goto(hostile)
  await expect(frame.locator('#ref')).toHaveText('none')
  await page.waitForTimeout(1000)
  expect(await frameHeight(page, app.name)).toBe(260)
  expect(await contexts(frame)).toEqual([])
  await context.close()
})

test('an app that does not answer in 10 s shows a message with Retry', async ({ browser, baseURL }) => {
  test.setTimeout(60_000)
  const { 'General request': general } = await types()
  const app = await addApp({ name: `Silent ${stamp}`, url: appUrl(baseURL!, 'silent'), position: 'sidebar' })
  const ref = await raise(admin, general!, `Silent app ${stamp}`)
  const context = await browser.newContext({ storageState: undefined })
  const page = await staffPage(await context.newPage())
  await page.goto(`/tickets/${ref}`)
  const card = page.getByRole('region', { name: app.name })
  await expect(card.getByRole('alert')).toHaveText(/The app did not answer/, { timeout: 15_000 })
  // The rest of the page works.
  await expect(page.getByRole('tab', { name: 'Conversation' })).toBeVisible()
  await card.getByRole('button', { name: 'Retry' }).click()
  await expect(card.locator('iframe')).toBeVisible()
  await context.close()
})

test('a tab app loads only when its tab opens; an app for chosen types shows only on them', async ({ browser, baseURL }) => {
  const { 'General request': general, Bug: bug } = await types()
  const tab = await addApp({ name: `History ${stamp}`, url: appUrl(baseURL!, 'normal', '&app=tab'), position: 'tab' })
  const bugOnly = await addApp({ name: `Crash log ${stamp}`, url: appUrl(baseURL!, 'normal', '&app=bug'), position: 'sidebar', ticket_type_ids: [bug!.id] })
  const generalRef = await raise(admin, general!, `Tab app ${stamp}`)
  const bugRef = await raise(admin, bug!, `Bug app ${stamp}`)

  const context = await browser.newContext({ storageState: undefined })
  const page = await staffPage(await context.newPage())
  const loads: string[] = []
  page.on('request', (r) => { if (r.url().startsWith(APP_ORIGIN)) loads.push(r.url()) })

  await page.goto(`/tickets/${generalRef}`)
  const tabButton = page.getByRole('tab', { name: tab.name })
  await expect(tabButton).toBeVisible()
  await expect(page.getByRole('region', { name: bugOnly.name })).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  expect(loads.filter(u => u.includes('app=tab'))).toEqual([])
  await expect(page.locator(`iframe[title="${tab.name}"]`)).toHaveCount(0)

  await tabButton.click()
  await expect(page).toHaveURL(new RegExp(`tab=app-${tab.id}`))
  const frame = await appFrame(page, tab.name)
  await expect(frame.locator('#ref')).toHaveText(generalRef)
  expect(loads.filter(u => u.includes('app=tab'))).toHaveLength(1)
  // Back and forth: the tab stays loaded.
  await page.getByRole('tab', { name: 'Conversation' }).click()
  await tabButton.click()
  expect(loads.filter(u => u.includes('app=tab'))).toHaveLength(1)

  await page.goto(`/tickets/${bugRef}`)
  await expect(page.getByRole('region', { name: bugOnly.name })).toBeVisible()
  await expect(page.getByRole('tab', { name: tab.name })).toBeVisible()
  await context.close()
})

test('a Requester sees no apps on their own ticket and asks for no token', async ({ page, baseURL }) => {
  const { 'General request': general } = await types()
  const app = await addApp({ name: `Hidden ${stamp}`, url: appUrl(baseURL!), position: 'sidebar' })
  await addApp({ name: `Hidden tab ${stamp}`, url: appUrl(baseURL!), position: 'tab' })
  // The default context is the shared Requester.
  const ref = await raise(page.request, general!, `Requester ticket ${stamp}`)
  const calls: string[] = []
  page.on('request', (r) => { if (r.url().includes('/apps') || r.url().startsWith(APP_ORIGIN)) calls.push(r.url()) })
  await page.goto(`/tickets/${ref}`)
  await expect(page.getByRole('heading', { name: `Requester ticket ${stamp}` })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.getByRole('region', { name: app.name })).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(2)
  expect(calls).toEqual([])
  expect((await page.request.post(`/api/v1/tickets/${ref}/apps/${app.id}/token`)).status()).toBe(403)
})

test('the admin page adds, orders, turns off and deletes an app', async ({ browser, baseURL }) => {
  const { Bug: bug } = await types()
  const context = await browser.newContext({ storageState: undefined })
  const page = await staffPage(await context.newPage())
  await page.getByRole('link', { name: 'Ticket Apps' }).click()
  await expect(page.getByRole('heading', { name: 'Ticket Apps', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Read the developer guide' })).toHaveAttribute('href', '/api/docs/ticket-apps.md')

  const name = `Lookup ${Date.now()}`
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: 'Add app' }).first().click()
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('URL').fill('http://orders.example.com/')
  await dialog.getByRole('radio', { name: 'Only these types' }).check()
  await dialog.getByRole('button', { name: 'Add app' }).click()
  await expect(dialog.getByText('Must use https.')).toBeVisible()
  await dialog.getByLabel('URL').fill(appUrl(baseURL!))
  await dialog.getByRole('button', { name: 'Add app' }).click()
  await expect(dialog.getByText('at least one', { exact: false })).toBeVisible()
  await dialog.getByRole('checkbox', { name: bug!.name }).check()
  await dialog.getByRole('button', { name: 'Add app' }).click()
  await expect(dialog).toBeHidden()

  const row = page.getByRole('region', { name })
  await expect(row).toContainText(`Shows on: ${bug!.name}`)
  const list = (await (await admin.get('/api/v1/admin/ticket-apps')).json()).data as { id: number, name: string }[]
  const mine = list.find(a => a.name === name)!
  created.push(mine.id)

  if (list.length > 1) {
    await row.getByRole('button', { name: `Move ${name} up` }).click()
    await expect.poll(async () => ((await (await admin.get('/api/v1/admin/ticket-apps')).json()).data as { id: number }[]).at(-2)?.id).toBe(mine.id)
  }
  await row.getByRole('switch').click()
  await expect(row.getByText('Off', { exact: true })).toBeVisible()

  await row.getByRole('button', { name: 'Edit' }).click()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await dialog.getByRole('button', { name: 'Delete app' }).click()
  await expect(row).toHaveCount(0)
  await context.close()
})
