import { expect, test, type Page } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

// The Admin is the first sign-in with ADMIN_EMAIL. The shared session of the other tests is a Requester.
async function adminPage(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext({ storageState: undefined })
  const page = await context.newPage()
  await signInAsAdmin(page)
  return page
}

async function addField(page: Page, label: string, type: string, options?: string) {
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  const form = page.locator('form').filter({ hasText: 'Data type' })
  await form.getByLabel('Label').fill(label)
  if (type !== 'Short text') {
    await form.getByRole('combobox', { name: 'Data type' }).click()
    await page.getByRole('option', { name: type, exact: true }).click()
  }
  if (options) await form.getByLabel('Options, one on each line').fill(options)
  await form.getByRole('button', { name: 'Add field' }).click()
}

test.describe.configure({ mode: 'serial' })

test('an Admin creates "Access request" with two Fields, and a Requester sees it in the web form', async ({ browser, page }) => {
  const admin = await adminPage(browser)
  await admin.goto('/admin/types')
  await expect(admin.getByRole('heading', { name: 'Ticket types' }).first()).toBeVisible()
  await admin.getByRole('link', { name: 'New ticket type' }).click()

  // A duplicate name is blocked while the Admin types, and the prefix is taken from the name.
  await admin.getByLabel('Name').fill('Bug')
  await expect(admin.getByText('A ticket type with this name exists.')).toBeVisible()
  await expect(admin.getByRole('button', { name: 'Create ticket type' })).toBeDisabled()
  await admin.getByLabel('Name').fill('Access request')
  await expect(admin.getByLabel('Number prefix')).toHaveValue('ACC')
  await expect(admin.getByText('Tickets look like ACC-1049')).toBeVisible()
  await admin.getByLabel('When to use it').fill('You need access to a system, a tool or a shared folder.')

  await addField(admin, 'System or tool', 'Single select', 'Wiki\nVPN')
  await addField(admin, 'Needed until', 'Date')
  await expect(admin.getByText('needed_until', { exact: true }).first()).toBeVisible()
  // The preview shows what Claude asks for.
  await expect(admin.getByText('System or tool · single select')).toBeVisible()

  await admin.getByRole('button', { name: 'Create ticket type' }).click()
  await expect(admin.getByRole('heading', { name: 'Access request' }).first()).toBeVisible()
  await expect(admin.getByText('Current: version 1')).toBeVisible()

  await page.goto('/tickets/new')
  const card = page.getByRole('button', { name: /^Access request/ })
  await expect(card).toBeVisible()
  await card.click()
  const form = page.locator('form')
  await expect(form.getByText('System or tool')).toBeVisible()
  await expect(form.getByText('Needed until')).toBeVisible()
  await admin.context().close()
})

test('an Admin adds a Field as version 2 and archives the type, and the Requester no longer sees it', async ({ browser, page }) => {
  const admin = await adminPage(browser)
  await admin.goto('/admin/types')
  await admin.getByRole('link', { name: /Access request/ }).click()
  await expect(admin.getByText('Current: version 1')).toBeVisible()

  await addField(admin, 'Reason', 'Long text')
  await expect(admin.getByText('Unsaved changes')).toBeVisible()
  await admin.getByRole('button', { name: 'Save as version 2' }).click()
  await expect(admin.getByText('Current: version 2')).toBeVisible()

  // A key is locked: the edit form shows it and offers no way to change it or the data type.
  await admin.getByRole('button', { name: 'Edit System or tool' }).click()
  await expect(admin.getByText('A key and its data type never change.')).toBeVisible()
  await admin.getByRole('button', { name: 'Done' }).click()

  await admin.getByRole('button', { name: 'Archive type' }).click()
  await expect(admin.getByText('This type is archived')).toBeVisible()

  await page.goto('/tickets/new')
  await expect(page.getByRole('button', { name: /^Bug/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Access request/ })).toHaveCount(0)

  await admin.goto('/admin/types')
  await expect(admin.getByRole('heading', { name: 'Archived types' })).toBeVisible()
  await admin.getByRole('button', { name: 'Restore Access request' }).click()
  await expect(admin.getByRole('link', { name: /Access request/ })).toBeVisible()
  await admin.context().close()
})

test('the Admin screens have no horizontal scroll at 375 px', async ({ browser }) => {
  const admin = await adminPage(browser)
  await admin.setViewportSize({ width: 375, height: 812 })
  const scrollWidth = () => admin.evaluate(() => document.documentElement.scrollWidth)
  for (const path of ['/admin/types', '/admin/types/new']) {
    await admin.goto(path)
    await expect(admin.getByRole('heading', { level: 1 }).first()).toBeVisible()
    expect(await scrollWidth(), path).toBeLessThanOrEqual(375)
  }
  await admin.goto('/admin/types')
  await admin.getByRole('link', { name: /Bug/ }).click()
  await expect(admin.getByText('Current: version 1')).toBeVisible()
  expect(await scrollWidth()).toBeLessThanOrEqual(375)
  await admin.context().close()
})
