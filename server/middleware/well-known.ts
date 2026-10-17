import { useAuth } from '../utils/services'

// Some MCP clients ask for the metadata at the bare root and ignore the issuer path (RFC 8414 path insertion).
const ROOT_ALIASES: Record<string, string> = {
  '/.well-known/oauth-authorization-server': '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/openid-configuration': '/api/auth/.well-known/openid-configuration',
}

/** Sends `/.well-known/*` to Better-Auth, which serves the OAuth and protected-resource metadata from its plugins. */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/.well-known/')) return
  const request = toWebRequest(event)
  const url = new URL(request.url)
  const alias = ROOT_ALIASES[url.pathname]
  if (alias) url.pathname = alias
  return useAuth().handler(alias ? new Request(url, request) : request)
})
