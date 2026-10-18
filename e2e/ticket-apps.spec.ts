import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
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
  const app = await addApp({ name: `Orders ${stamp}`, sidebar_url: appUrl(baseURL!) })
  // Same origin as Orders: only the event source tells their messages apart.
  const twin = await addApp({ name: `Refunds ${stamp}`, sidebar_url: appUrl(baseURL!, 'normal', '&app=twin') })
  const ref = await raise(admin, general!, `Charged twice ${stamp}`)

  const context = await browser.newContext({ storageState: undefined, colorScheme: 'dark' })
  const page = await staffPage(await context.newPage())
  await page.goto(`/tickets/${ref}`)
  const card = page.getByRole('region', { name: app.name })
  await expect(card).toBeVisible()
  const iframe = card.locator('iframe')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox')
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  // No Permissions Policy grant: in particular not `tools`, so the app gets no WebMCP access through Tikki.
  expect(await iframe.getAttribute('allow')).toBeNull()
  expect(await frameHeight(page, app.name)).toBe(200)

  const frame = await appFrame(page, app.name)
  await expect(frame.locator('#ref')).toHaveText(ref)
  const [first] = await contexts(frame)
  expect(first!.theme).toBe('dark')
  expect(first!.data).toMatchObject({ version: 1, app: { id: app.id, name: app.name, placement: 'sidebar' }, ticket: { ref, ticket_type: { id: general!.id } }, requester: { kind: 'user' } })
  expect(first!.data).not.toHaveProperty('comments')
  const claims = JSON.parse(Buffer.from(first!.token.split('.')[1]!, 'base64url').toString())
  expect(claims).toMatchObject({ aud: APP_ORIGIN, tikki_ticket: ref, tikki_scope: 'read', tikki_app: app.id, tikki_placement: 'sidebar' })

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

test('one app with a sidebar URL and a tab URL shows a card and a tab, each frame with its own placement', async ({ browser, baseURL }) => {
  stamp = Date.now()
  const { 'General request': general } = await types()
  // The tab on another origin, so each token's audience is the origin of its own placement.
  const tabOrigin = APP_ORIGIN.replace('localhost', '127.0.0.1')
  const app = await addApp({
    name: `Orders ${stamp}`,
    sidebar_url: appUrl(baseURL!, 'normal', '&app=both'),
    tab_url: appUrl(baseURL!, 'normal', '&app=both').replace(APP_ORIGIN, tabOrigin),
  })
  const ref = await raise(admin, general!, `Two views ${stamp}`)
  const context = await browser.newContext({ storageState: undefined })
  const page = await staffPage(await context.newPage())
  await page.goto(`/tickets/${ref}`)
  await expect(page.getByRole('region', { name: app.name, exact: true })).toBeVisible()
  const tabButton = page.getByRole('tab', { name: app.name, exact: true })
  await expect(tabButton).toBeVisible()

  const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
  const check = async (placement: 'sidebar' | 'tab', origin: string) => {
    const frame = await appFrame(page, app.name, placement)
    const url = new URL(frame.url())
    expect(url.origin).toBe(origin)
    // The Admin's own query stays.
    expect(url.searchParams.get('app')).toBe('both')
    expect(url.searchParams.get('placement')).toBe(placement)
    const [first] = await contexts(frame)
    expect(first!.data.app).toEqual({ id: app.id, name: app.name, placement })
    expect(claims(first!.token)).toMatchObject({ aud: origin, tikki_app: app.id, tikki_placement: placement, tikki_ticket: ref })
  }
  await check('sidebar', APP_ORIGIN)
  await tabButton.click()
  await check('tab', tabOrigin)
  await context.close()
})

test('an app with comment access adds an internal note through its backend, and the ticket reloads', async ({ browser, baseURL }) => {
  stamp = Date.now()
  const { 'General request': general } = await types()
  const app = await addApp({ name: `Refunds ${stamp}`, sidebar_url: appUrl(baseURL!, 'writer'), access: 'comment' })
  const ref = await raise(admin, general!, `Refund please ${stamp}`)

  const context = await browser.newContext({ storageState: undefined })
  const page = await staffPage(await context.newPage())
  await page.goto(`/tickets/${ref}`)
  const frame = await appFrame(page, app.name)
  expect(JSON.parse(Buffer.from((await contexts(frame))[0]!.token.split('.')[1]!, 'base64url').toString()).tikki_scope).toBe('comment')
  await frame.getByRole('button', { name: 'Add note' }).click()
  await expect(frame.locator('#result')).toHaveText('201')

  // No reload of the page: tikki:refresh brought the note in.
  const note = page.getByRole('article').filter({ hasText: 'Refund issued by the test app.' })
  await expect(note).toBeVisible()
  await expect(note).toContainText('Internal')
  await expect(note).toContainText(`via ${app.name}`)
  await context.close()
})

test('an app that does not answer in 10 s shows a message with Retry', async ({ browser, baseURL }) => {
  test.setTimeout(60_000)
  const { 'General request': general } = await types()
  const app = await addApp({ name: `Silent ${stamp}`, sidebar_url: appUrl(baseURL!, 'silent') })
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
  const tab = await addApp({ name: `History ${stamp}`, tab_url: appUrl(baseURL!, 'normal', '&app=tab') })
  const bugOnly = await addApp({ name: `Crash log ${stamp}`, sidebar_url: appUrl(baseURL!, 'normal', '&app=bug'), ticket_type_ids: [bug!.id] })
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
  const app = await addApp({ name: `Hidden ${stamp}`, sidebar_url: appUrl(baseURL!) })
  await addApp({ name: `Hidden tab ${stamp}`, tab_url: appUrl(baseURL!) })
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
  expect((await page.request.post(`/api/v1/tickets/${ref}/apps/${app.id}/token`, { data: { placement: 'sidebar' } })).status()).toBe(403)
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
  await dialog.getByLabel('Sidebar URL').fill('http://orders.example.com/')
  await dialog.getByRole('radio', { name: 'Only these types' }).check()
  await dialog.getByRole('button', { name: 'Add app' }).click()
  // Exact: the help text of the URL group also says "must use https".
  await expect(dialog.getByText('Must use https.', { exact: true })).toBeVisible()
  await dialog.getByLabel('Sidebar URL').fill(appUrl(baseURL!))
  await dialog.getByRole('button', { name: 'Add app' }).click()
  await expect(dialog.getByText('Choose at least one Ticket Type, or show the app on all types.', { exact: true })).toBeVisible()
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

// Issue 38: icons. Two square SVGs with a size, so `naturalWidth` shows that the image loaded.
const svg = (fill: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/></svg>`)
const LIGHT_ICON = svg('#e11d48')
const DARK_ICON = svg('#38bdf8')

async function uploadIcon(id: number, mode: 'light' | 'dark', body: Buffer) {
  const res = await admin.put(`/api/v1/admin/ticket-apps/${id}/icon?mode=${mode}`, { data: body, headers: { 'content-type': 'image/svg+xml' } })
  expect(res.status(), await res.text()).toBe(200)
}

/** The icon inside `scope`: what it is, and for an image which mode it asked for and whether it loaded. */
async function iconOf(scope: Locator) {
  const icon = scope.locator('[data-app-icon]').first()
  await expect(icon).toBeVisible()
  const kind = await icon.getAttribute('data-app-icon')
  if (kind === 'builtin') return { kind, color: await icon.evaluate(el => getComputedStyle(el).color) }
  await expect.poll(() => icon.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  return { kind, mode: new URL(await icon.evaluate((el: HTMLImageElement) => el.currentSrc)).searchParams.get('mode') }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`app icons show on the card, the tab and the admin list, ${scheme} mode`, async ({ browser, baseURL }) => {
    stamp = Date.now()
    const { Bug: bug } = await types()
    const plain = await addApp({ name: `Plain ${stamp}`, sidebar_url: appUrl(baseURL!), ticket_type_ids: [bug!.id], icon_name: 'i-lucide-bug', icon_color: '#C2362F' })
    const both = await addApp({ name: `Both ${stamp}`, sidebar_url: appUrl(baseURL!), tab_url: appUrl(baseURL!), ticket_type_ids: [bug!.id] })
    const lightOnly = await addApp({ name: `Light ${stamp}`, sidebar_url: appUrl(baseURL!), ticket_type_ids: [bug!.id] })
    await uploadIcon(both.id, 'light', LIGHT_ICON)
    await uploadIcon(both.id, 'dark', DARK_ICON)
    await uploadIcon(lightOnly.id, 'light', LIGHT_ICON)
    const ref = await raise(admin, bug!, `Icons ${stamp}`)

    const context = await browser.newContext({ storageState: undefined, colorScheme: scheme })
    const page = await staffPage(await context.newPage())
    await page.goto(`/tickets/${ref}`)
    expect(await iconOf(page.getByRole('region', { name: plain.name }))).toEqual({ kind: 'builtin', color: 'rgb(194, 54, 47)' })
    expect(await iconOf(page.getByRole('region', { name: both.name }))).toEqual({ kind: 'image', mode: scheme })
    // No dark image: the light one shows in dark mode.
    expect(await iconOf(page.getByRole('region', { name: lightOnly.name }))).toEqual({ kind: 'image', mode: 'light' })
    expect(await iconOf(page.getByRole('tab', { name: both.name }))).toEqual({ kind: 'image', mode: scheme })

    await page.goto('/admin/apps')
    expect(await iconOf(page.getByRole('region', { name: plain.name }))).toEqual({ kind: 'builtin', color: 'rgb(194, 54, 47)' })
    expect(await iconOf(page.getByRole('region', { name: both.name }))).toEqual({ kind: 'image', mode: scheme })
    expect(await iconOf(page.getByRole('region', { name: lightOnly.name }))).toEqual({ kind: 'image', mode: 'light' })
    await context.close()
  })
}

test('the admin form uploads a light and a dark image, refuses a wrong file, and removes the dark image', async ({ browser, baseURL }) => {
  stamp = Date.now()
  const context = await browser.newContext({ storageState: undefined })
  const page = await staffPage(await context.newPage())
  await page.goto('/admin/apps')
  const name = `Icon form ${stamp}`
  const dialog = page.getByRole('dialog')
  await page.getByRole('button', { name: 'Add app' }).first().click()
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Sidebar URL').fill(appUrl(baseURL!))

  // The built-in picker is the default. Image mode needs a light image to save.
  await dialog.getByRole('button', { name: 'Upload image' }).click()
  await expect(dialog.getByLabel('Dark image file')).toBeDisabled()
  await dialog.getByRole('button', { name: 'Add app' }).click()
  await expect(dialog.getByText('Add a light image, or choose a built-in icon.', { exact: true })).toBeVisible()

  await dialog.getByLabel('Light image file').setInputFiles({ name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') })
  await expect(dialog.getByText('The image must be a PNG, WebP or SVG file.', { exact: true })).toBeVisible()
  await dialog.getByLabel('Light image file').setInputFiles({ name: 'big.svg', mimeType: 'image/svg+xml', buffer: Buffer.concat([svg('#000'), Buffer.alloc(256 * 1024)]) })
  await expect(dialog.getByText('The image must be 256 KB or smaller.', { exact: true })).toBeVisible()

  await dialog.getByLabel('Light image file').setInputFiles({ name: 'light.svg', mimeType: 'image/svg+xml', buffer: LIGHT_ICON })
  await dialog.getByLabel('Dark image file').setInputFiles({ name: 'dark.svg', mimeType: 'image/svg+xml', buffer: DARK_ICON })
  await expect(dialog.getByTestId('icon-preview-light')).toBeVisible()
  await expect(dialog.getByTestId('icon-tile-dark').locator('img')).toHaveAttribute('src', /^blob:/)
  await dialog.getByRole('button', { name: 'Add app' }).click()
  await expect(dialog).toBeHidden()

  const row = page.getByRole('region', { name })
  const list = (await (await admin.get('/api/v1/admin/ticket-apps')).json()).data as { id: number, name: string, icon: { light: boolean, dark: boolean } }[]
  const mine = list.find(a => a.name === name)!
  created.push(mine.id)
  expect(mine.icon).toMatchObject({ light: true, dark: true })
  expect(await iconOf(row)).toEqual({ kind: 'image', mode: 'light' })

  // Remove the dark image alone.
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(dialog.getByTestId('icon-preview-dark')).toBeVisible()
  await dialog.getByRole('button', { name: 'Remove the dark image' }).click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = (await (await admin.get('/api/v1/admin/ticket-apps')).json()).data as typeof list
  expect(after.find(a => a.id === mine.id)!.icon).toMatchObject({ light: true, dark: false })

  // Back to a built-in icon: the images go.
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  await dialog.getByRole('button', { name: 'Built-in icon' }).click()
  await dialog.getByRole('button', { name: 'Bug icon' }).click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  const final = (await (await admin.get('/api/v1/admin/ticket-apps')).json()).data as (typeof list[number] & { icon: { name: string, kind: string } })[]
  expect(final.find(a => a.id === mine.id)!.icon).toMatchObject({ kind: 'builtin', name: 'i-lucide-bug', light: false })
  expect((await admin.get(`/api/v1/ticket-apps/${mine.id}/icon?mode=light`)).status()).toBe(404)
  await context.close()
})
