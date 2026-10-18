import { readFileSync } from 'node:fs'
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

/** The Admin session that auth.setup.ts stored. */
export const ADMIN_STATE = 'e2e/.auth/admin.json'

/** Makes the page's context the Admin, with the stored session: no new sign-in code. Ends on My tickets. */
export async function signInAsAdmin(page: Page) {
  const { cookies } = JSON.parse(readFileSync(ADMIN_STATE, 'utf8')) as { cookies: Parameters<ReturnType<Page['context']>['addCookies']>[0] }
  await page.context().clearCookies()
  await page.context().addCookies(cookies)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My tickets' }).first()).toBeVisible()
}
