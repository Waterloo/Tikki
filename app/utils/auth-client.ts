import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { emailOTPClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'

// oauthProviderClient adds the signed OAuth query of the current page to sign-in and consent requests,
// so the sign-in inside the Claude popup continues the OAuth flow.
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), oauthProviderClient()],
})

/** Follows the OAuth continuation that Better-Auth returns after sign-in or consent. */
export function followRedirect(data: unknown): boolean {
  const url = (data as { url?: unknown } | null)?.url
  if (typeof url !== 'string') return false
  window.location.href = url
  return true
}
