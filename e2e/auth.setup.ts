import { test as setup } from '@playwright/test'
import { ADMIN_STATE, signIn } from './sign-in'

// Other tests reuse these sessions. Only sign-in.spec.ts signs in again, with its own address.
setup('sign in once and keep the session', async ({ page }) => {
  await signIn(page, 'e2e-shared@example.com')
  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})

// The sign-in code limit is 5 an hour for one address, and many specs act as the Admin.
setup('sign in the Admin once and keep the session', async ({ browser }) => {
  const context = await browser.newContext({ storageState: undefined })
  await signIn(await context.newPage(), 'admin@example.com')
  await context.storageState({ path: ADMIN_STATE })
  await context.close()
})
