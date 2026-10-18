import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN_STATE, signInAsAdmin } from './sign-in'
import { APP_ORIGIN, APP_PORT, appFrame } from './ticket-app'

// Issue 40: add a Ticket App from its manifest, and apply an update (docs/ticket-apps.md#manifest).

let admin: APIRequestContext
const created: number[] = []

test.beforeAll(async ({ playwright, baseURL }) => {
  admin = await playwright.request.newContext({ baseURL, storageState: ADMIN_STATE })
})
// Apps show on every ticket, so none stays for the other specs.
test.afterAll(async () => {
  for (const id of created) await admin.delete(`/api/v1/admin/ticket-apps/${id}`)
  await admin.dispose()
})

/** Sets keys of the test app's manifest for this `key` (e2e/ticket-app-server.mjs). */
async function setManifest(key: string, keys: Record<string, unknown>) {
  const res = await fetch(`${APP_ORIGIN}/tikki-app.json?key=${key}`, { method: 'PUT', body: JSON.stringify(keys) })
  expect(res.status).toBe(204)
}

test('add from manifest: preview with both icons, approve, see the app on a ticket, then check and apply an update', async ({ browser, baseURL }) => {
  const stamp = Date.now()
  const key = `m${stamp}`
  const name = `Time tracking ${stamp}`
  await setManifest(key, { name })
  const manifestUrl = `${APP_ORIGIN}/tikki-app.json?key=${key}`

  const context = await browser.newContext({ storageState: undefined })
  const page = await context.newPage()
  // The browser never loads an icon from the app's site: Tikki copies them.
  const iconLoads: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith(APP_ORIGIN) && r.url().includes('/icon-')) iconLoads.push(r.url())
  })
  await signInAsAdmin(page)
  await page.goto('/admin/apps')
  await page.getByRole('button', { name: 'Add from manifest', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add from manifest' })
  await dialog.getByLabel('Manifest URL').fill(manifestUrl)
  await dialog.getByRole('button', { name: 'Load preview', exact: true }).click()

  const preview = dialog.getByTestId('manifest-preview')
  await expect(preview.getByRole('heading', { name })).toBeVisible()
  await expect(preview.getByText('Log time on tickets. Timesheet for the team.')).toBeVisible()
  for (const tile of ['manifest-icon-light', 'manifest-icon-dark']) {
    const img = dialog.getByTestId(tile).locator('img')
    await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/)
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  }
  // Light and dark are two images.
  const sources = await Promise.all(['manifest-icon-light', 'manifest-icon-dark'].map(t => dialog.getByTestId(t).locator('img').getAttribute('src')))
  expect(sources[0]).not.toBe(sources[1])
  await expect(preview.getByText(`${APP_ORIGIN}/app.html`).first()).toBeVisible()
  await expect(preview.getByTestId('requested-access')).toHaveText('Comment access')
  // Above the requested access: not a choice.
  await expect(dialog.getByRole('radio', { name: 'Update', exact: true })).toBeDisabled()

  await dialog.getByRole('radio', { name: 'Read', exact: true }).check()
  await dialog.getByRole('button', { name: 'Add app', exact: true }).click()
  await expect(dialog).toBeHidden()
  const row = page.getByRole('region', { name, exact: true })
  await expect(row).toBeVisible()
  await expect(row.getByText('Read access', { exact: true })).toBeVisible()
  await expect(row.getByText(manifestUrl)).toBeVisible()

  const apps = (await (await admin.get('/api/v1/admin/ticket-apps')).json()).data as { id: number, name: string, access: string, icon: { kind: string, dark: boolean }, manifest: { url: string } }[]
  const app = apps.find(a => a.name === name)!
  created.push(app.id)
  expect(app).toMatchObject({ access: 'read', icon: { kind: 'image', dark: true }, manifest: { url: manifestUrl } })

  // The app on a ticket.
  const types = (await (await admin.get('/api/v1/ticket-types')).json()).data as { id: number, name: string }[]
  const res = await admin.post('/api/v1/tickets', { data: { ticket_type_id: types.find(t => t.name === 'General request')!.id, title: `Log time ${stamp}` } })
  const { ref } = await res.json()
  await page.goto(`/tickets/${ref}`)
  await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
  const frame = await appFrame(page, name, 'sidebar')
  await expect(frame.locator('#ref')).toHaveText(ref)

  // An update with a new origin and a higher access.
  const other = `http://127.0.0.1:${APP_PORT}`
  await setManifest(key, { name, urls: { sidebar: `/app.html?tikki=${encodeURIComponent(baseURL!)}&mode=normal`, tab: `${other}/app.html?tikki=${encodeURIComponent(baseURL!)}&mode=normal` }, access: 'update' })
  await page.goto('/admin/apps')
  await row.getByRole('button', { name: 'Check for updates', exact: true }).click()
  const update = page.getByRole('dialog', { name: `Updates for ${name}` })
  const changes = update.getByRole('list', { name: 'Changes' })
  await expect(changes.getByText(`New origin: ${other}`)).toBeVisible()
  await expect(changes.getByText('The app asks for more access: update.')).toBeVisible()
  await expect(changes.getByText('Page URL', { exact: true })).toBeVisible()
  const applyButton = update.getByRole('button', { name: 'Apply update', exact: true })
  await expect(applyButton).toBeDisabled()
  // Nothing changed yet.
  expect((await (await admin.get('/api/v1/admin/ticket-apps')).json()).data.find((a: { id: number }) => a.id === app.id)).toMatchObject({ access: 'read', urls: { tab: null } })

  await update.getByRole('checkbox', { name: 'I checked the warnings above' }).check()
  await update.getByRole('radio', { name: 'Update', exact: true }).check()
  await applyButton.click()
  await expect(update).toBeHidden()
  await expect(row.getByText('Update access', { exact: true })).toBeVisible()
  await expect(row.getByText('Tab', { exact: true })).toBeVisible()

  expect(iconLoads).toEqual([])
  await context.close()
})
