// Pages that work without a session. Consent has its own signed OAuth query and redirects to sign-in itself.
const PUBLIC_PATHS = new Set(['/sign-in', '/consent'])

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_PATHS.has(to.path)) return
  const { data } = await authClient.getSession()
  if (!data) return navigateTo('/sign-in')
})
