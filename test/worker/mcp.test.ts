import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import { BASE, call, getMcpToken, MCP_URL, signIn, uniqueEmail, worker } from './helpers'

function connect(accessToken: string, mode: 'modern' | 'legacy') {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (input, init) => worker.fetch(input as string, init),
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  })
  return client.connect(transport, mode === 'legacy' ? { prior: { kind: 'legacy' } } : {}).then(() => client)
}

describe('MCP endpoint', () => {
  it('answers a request without a token with 401 and the protected-resource metadata pointer', async () => {
    const res = await call('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`)
  })

  it('publishes metadata where Claude looks for it', async () => {
    const prm = await (await call('/.well-known/oauth-protected-resource/mcp')).json() as Record<string, unknown>
    // Claude needs `resource` to equal the MCP URL exactly.
    expect(prm.resource).toBe(MCP_URL)
    expect(prm.authorization_servers).toEqual([`${BASE}/api/auth`])

    for (const path of ['/.well-known/oauth-authorization-server/api/auth', '/.well-known/oauth-authorization-server', '/api/auth/.well-known/openid-configuration']) {
      const res = await call(path)
      expect(res.status, path).toBe(200)
      const meta = await res.json() as Record<string, unknown>
      expect(meta.issuer).toBe(`${BASE}/api/auth`)
      expect(meta.code_challenge_methods_supported).toEqual(['S256'])
      expect(meta.registration_endpoint).toBe(`${BASE}/api/auth/oauth2/register`)
      expect(meta.client_id_metadata_document_supported).toBe(true)
    }
  })

  it('refuses a token that is not ours', async () => {
    const res = await call('/mcp', { method: 'POST', headers: { authorization: 'Bearer not-a-token' }, body: '{}' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=')
  })

  for (const mode of ['legacy', 'modern'] as const) {
    it(`creates a ticket with create_ticket (${mode} protocol), and REST reads it back`, async () => {
      const { cookie, user } = await signIn(uniqueEmail())
      const { access_token } = await getMcpToken(cookie)
      const client = await connect(access_token, mode)

      const { tools } = await client.listTools()
      const tool = tools.find(t => t.name === 'create_ticket')
      expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
      expect(tool?.inputSchema.required).toEqual(['title'])

      const result = await client.callTool({ name: 'create_ticket', arguments: { title: 'The export button fails' } })
      expect(result.isError).toBeFalsy()
      const { number, ref } = result.structuredContent as { number: number, ref: string }
      expect(ref).toBe(`GEN-${number}`)
      await client.close()

      const read = await call(`/api/v1/tickets/${ref}`, { headers: { cookie } })
      expect(read.status).toBe(200)
      expect(await read.json()).toMatchObject({ number, ref, title: 'The export button fails', requester_id: user.id, channel: 'ai', ticket_type: { prefix: 'GEN' } })

      const list = await (await call('/api/v1/tickets?requester=me', { headers: { cookie } })).json() as { data: { ref: string }[] }
      expect(list.data.map(t => t.ref)).toContain(ref)
    })
  }

  it('returns a repairable error when the title is missing', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const { access_token } = await getMcpToken(cookie)
    const client = await connect(access_token, 'legacy')
    const result = await client.callTool({ name: 'create_ticket', arguments: { title: '   ' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Title is required')
    await client.close()
  })

  it('rotates refresh tokens and answers a bad refresh token with invalid_grant', async () => {
    const { cookie } = await signIn(uniqueEmail())
    const tokens = await getMcpToken(cookie)
    const refresh = (refresh_token: string) => call('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id: tokens.client_id, resource: MCP_URL }),
    })
    const res = await refresh(tokens.refresh_token)
    expect(res.status).toBe(200)
    const next = await res.json() as { access_token: string, refresh_token: string }
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    await (await connect(next.access_token, 'legacy')).close()

    const bad = await refresh('not-a-refresh-token')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'invalid_grant' })
  })
})
