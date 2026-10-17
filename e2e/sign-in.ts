import { expect, type Page } from '@playwright/test'
import { logSize, readCode } from './mail'

/** Signs in through the UI with the code from the server log. Ends on My tickets. */
export async function signIn(page: Page, email: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Work email').fill(email)
  // Take the offset before the click, so an older code for the same address is never read.
  const from = logSize()
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Code').fill(await readCode(email, from))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'My tickets' }).first()).toBeVisible()
}
