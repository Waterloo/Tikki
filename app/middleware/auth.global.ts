import type { Role } from '~/utils/navigation'

// Pages that work without a session. Consent has its own signed OAuth query and redirects to sign-in itself.
const PUBLIC_PATHS = new Set(['/sign-in', '/consent'])

declare module '#app' {
  interface PageMeta {
    /** The roles the page is for. Others go to My tickets. The API still decides what each role may see and do. */
    roles?: readonly Role[]
  }
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_PATHS.has(to.path)) return
  const { data } = await authClient.getSession()
  // The page that needed the session comes back after sign-in (the Upload Link relies on it).
  if (!data) return navigateTo(to.fullPath === '/' ? '/sign-in' : { path: '/sign-in', query: { redirect: to.fullPath } })
  const role = (data.user as { role?: unknown }).role
  if (to.meta.roles && !(isRole(role) && to.meta.roles.includes(role))) return navigateTo('/')
})
