import { describe, expect, it } from 'vitest'
import { signIn, uniqueEmail } from './helpers'

// The only test file that signs in with ADMIN_EMAIL, so no other test can become the first Admin.
describe('bootstrap Admin', () => {
  it('makes the first sign-in with ADMIN_EMAIL an Admin, and later Users Requesters', async () => {
    const before = await signIn(uniqueEmail())
    expect(before.user.role).toBe('requester')

    // ADMIN_EMAIL is "Admin@Example.com" in the test config: the match ignores letter case.
    const admin = await signIn('admin@example.com')
    expect(admin.user.role).toBe('admin')

    const again = await signIn('admin@example.com')
    expect(again.user.role).toBe('admin')

    const after = await signIn(uniqueEmail())
    expect(after.user.role).toBe('requester')
  })
})
