/** Issue 39: the Tikki paths a Ticket App may open with `tikki:navigate` (docs/ticket-apps-reference.md#messages). */

const ALLOWED = /^\/(?:tickets|apps)\//
// Any origin works: only the path is kept.
const BASE = 'http://tikki.invalid'

/**
 * The path to open, or null to ignore the message. Only `/tickets/...` and `/apps/...`, with no `//`, no backslash and
 * no white space or control character. The check runs again on the normalized URL, because the browser resolves
 * `..` and `%2e%2e`, so `/tickets/%2e%2e/sign-out` would otherwise open `/sign-out`.
 */
export function appNavigationPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  if (!ALLOWED.test(value) || value.includes('//') || value.includes('\\') || /[\u0000- \u007f]/.test(value)) return null
  let url: URL
  try {
    url = new URL(value, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE || !ALLOWED.test(url.pathname) || url.pathname.includes('//')) return null
  return url.pathname + url.search + url.hash
}
