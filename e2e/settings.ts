import { expect, type Page } from '@playwright/test'

/** Opens a Settings page as an Admin does on a desktop: the Settings entry, then the item in the Settings menu. */
export async function openSettings(page: Page, item: string) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: item, exact: true }).click()
}

/**
 * Opens Applications and waits until the page is settled. With an Application in the list, the page opens the first
 * one, and that navigation mounts the page again: a click before it is lost.
 */
export async function openApplications(page: Page) {
  await openSettings(page, 'Applications')
  const selected = page.getByRole('navigation', { name: 'Applications' }).locator('[aria-current="page"]')
  await expect(selected.or(page.getByText('No applications yet'))).toBeVisible()
}
