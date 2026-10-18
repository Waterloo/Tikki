import { expect, type Page } from '@playwright/test'

/** Expects a toast with exactly this title. A Nuxt UI toast also writes its text into a hidden live region, so a loose getByText finds two elements. */
export async function expectToast(page: Page, title: string) {
  await expect(page.locator('[data-slot="title"]').getByText(title, { exact: true })).toBeVisible()
}
