import { test as setup } from '@playwright/test'
import { signIn } from './sign-in'

// Other tests reuse this session. Only sign-in.spec.ts signs in again, with its own address.
setup('sign in once and keep the session', async ({ page }) => {
  await signIn(page, 'e2e-shared@example.com')
  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})
