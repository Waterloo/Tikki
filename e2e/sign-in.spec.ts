import { expect, test } from '@playwright/test'
import { signIn } from './sign-in'

test.use({ storageState: { cookies: [], origins: [] } })

test('sign in with the emailed code and see My tickets', async ({ page }) => {
  await signIn(page, 'e2e-sign-in@example.com')
  await expect(page.getByText('e2e-sign-in@example.com')).toBeVisible()
  await expect(page.getByText('You have no tickets yet')).toBeVisible()
})
