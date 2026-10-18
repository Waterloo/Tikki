/** `DOCS_SITE_URL` as an origin, or '' when it is not set. Anything other than an http(s) origin fails the build. */
export function siteUrlFrom(value: string | undefined): string {
  if (!value) return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`DOCS_SITE_URL must be an origin such as https://tikki.example.com, not "${value}".`)
  }
  if (!/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username) {
    throw new Error(`DOCS_SITE_URL must be an origin such as https://tikki.example.com, with no path, not "${value}".`)
  }
  return url.origin
}
