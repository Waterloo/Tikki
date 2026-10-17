import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider'

/**
 * Hosts whose Client ID Metadata Documents we fetch. Other MCP clients use DCR.
 *
 * Workers cannot pin a resolved address for `fetch`, so the resolve-once check that the Node transport
 * does is not possible here. The allow list closes the SSRF risk instead: we only ever fetch from these hosts.
 */
export const CIMD_ALLOWED_HOSTS: ReadonlySet<string> = new Set(['claude.ai', 'claude.com'])

export function isCimdUrlAllowed(url: string | URL): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && CIMD_ALLOWED_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/** The Workers transport for CIMD: allow-listed HTTPS hosts only, GET/HEAD only, and no redirects. */
export const fetchClientMetadataResource: ClientMetadataResourceFetch = async (input, init) => {
  const request = new Request(input, init)
  if (!isCimdUrlAllowed(request.url)) throw new TypeError(`CIMD fetch refused: ${new URL(request.url).host} is not an allowed metadata host`)
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new TypeError('CIMD fetch supports only GET and HEAD')
  return fetch(request.url, { method: request.method, headers: request.headers, signal: request.signal, redirect: 'manual' })
}
