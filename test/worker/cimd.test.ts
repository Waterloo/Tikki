import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, MCP_URL } from './helpers'

const CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata'
const METADATA = {
  client_id: CLIENT_ID,
  client_name: 'Claude Code',
  client_uri: 'https://claude.ai',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
}

// The plugin backs off after a failed fetch for one client_id, so each test uses its own.
function authorizeUrl(clientId = CLIENT_ID) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    code_challenge: 'vw_7Nq7WFGIVRLRQJckW7Et2JQ8t6kaH_5Is8cTTEic',
    code_challenge_method: 'S256',
    redirect_uri: 'http://localhost:63523/callback',
    state: 'state-1',
    resource: MCP_URL,
  })
  return `/api/auth/oauth2/authorize?${params}`
}

describe('CIMD client (Claude Code)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fetches the metadata document and sends the User to sign in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(METADATA), { headers: { 'content-type': 'application/json' } }))

    const res = await call(authorizeUrl())

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe(CLIENT_ID)
    expect(init?.redirect).toBe('manual')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/sign-in')
  })

  it('refuses a metadata document that redirects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'https://example.net/metadata' } }))

    const res = await call(authorizeUrl('https://claude.ai/oauth/redirecting-client-metadata'))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_client' })
  })
})
