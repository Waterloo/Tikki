import { describe, expect, it } from 'vitest'
import { BASE, call, connectMcp as connect, getMcpToken, MCP_URL, signIn, uniqueEmail } from './helpers'

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

  async function connected() {
    const { cookie, user } = await signIn(uniqueEmail())
    const { access_token } = await getMcpToken(cookie)
    return { cookie, user, client: await connect(access_token, 'legacy') }
  }

  type TypeRow = { id: number, name: string, description: string, prefix: string }
  async function typeByPrefix(client: Client, prefix: string) {
    const listed = await client.callTool({ name: 'list_ticket_types', arguments: {} })
    const found = (listed.structuredContent as { ticket_types: TypeRow[] }).ticket_types.find(t => t.prefix === prefix)
    if (!found) throw new Error(`no type ${prefix}`)
    return found
  }

  it('annotates read tools as read-only and the write tool as a write', async () => {
    const { client } = await connected()
    const { tools } = await client.listTools()
    const by = Object.fromEntries(tools.map(t => [t.name, t]))
    expect(Object.keys(by).sort()).toEqual(['add_comment', 'assign_ticket', 'attach_text', 'change_priority', 'change_status', 'create_ticket', 'get_ticket', 'get_ticket_type', 'list_my_tickets', 'list_ticket_types', 'request_upload_link', 'search_tickets'])
    expect(by.list_ticket_types!.annotations).toMatchObject({ readOnlyHint: true })
    expect(by.get_ticket_type!.annotations).toMatchObject({ readOnlyHint: true })
    expect(by.create_ticket!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(by.create_ticket!.inputSchema.required).toEqual(['ticket_type_id', 'title'])
    await client.close()
  })

  it('list_ticket_types returns every type with name, description and prefix', async () => {
    const { cookie, client } = await connected()
    const result = await client.callTool({ name: 'list_ticket_types', arguments: {} })
    expect(result.isError).toBeFalsy()
    const { ticket_types } = result.structuredContent as { ticket_types: TypeRow[] }
    const rest = await (await call('/api/v1/ticket-types', { headers: { cookie } })).json() as { data: TypeRow[] }
    expect(ticket_types).toEqual(rest.data.map(({ id, name, description, prefix }) => ({ id, name, description, prefix })))
    expect(ticket_types.map(t => t.prefix)).toEqual(['BUG', 'DATA', 'GEN'])
    expect(ticket_types.every(t => t.description.length > 0)).toBe(true)
    await client.close()
  })

  it('get_ticket_type returns JSON Schema that matches the Field definitions', async () => {
    const { cookie, client } = await connected()
    const bug = await typeByPrefix(client, 'BUG')
    const result = await client.callTool({ name: 'get_ticket_type', arguments: { ticket_type_id: bug.id } })
    expect(result.isError).toBeFalsy()
    const out = result.structuredContent as { prefix: string, schema_version: number, fields_schema: Record<string, any> }
    expect(out).toMatchObject({ prefix: 'BUG', schema_version: 1 })
    const schema = out.fields_schema
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['page_or_feature'] })
    expect(Object.keys(schema.properties)).toEqual(['page_or_feature', 'steps_to_reproduce', 'frequency'])
    expect(schema.properties.page_or_feature).toMatchObject({ type: 'string', title: 'Page or feature', description: 'Where you saw the problem, for example: Reports.' })
    expect(schema.properties.frequency).toMatchObject({ type: 'string', enum: ['Every time', 'Sometimes', 'Once'], description: 'Choose the closest answer.' })

    const data = (await client.callTool({ name: 'get_ticket_type', arguments: { ticket_type_id: (await typeByPrefix(client, 'DATA')).id } })).structuredContent as { fields_schema: Record<string, any> }
    expect(data.fields_schema.properties.needed_by).toMatchObject({ type: 'string', format: 'date' })

    // Same Fields as REST.
    const rest = await (await call(`/api/v1/ticket-types/${bug.id}`, { headers: { cookie } })).json() as { fields: { key: string, required: boolean }[] }
    expect(rest.fields.filter(f => f.required).map(f => f.key)).toEqual(schema.required)

    const missing = await client.callTool({ name: 'get_ticket_type', arguments: { ticket_type_id: 99999 } })
    expect(missing.isError).toBe(true)
    await client.close()
  })

  for (const mode of ['legacy', 'modern'] as const) {
    it(`creates a ticket with Fields (${mode} protocol), and REST reads it back with channel ai`, async () => {
      const { cookie, user } = await signIn(uniqueEmail())
      const { access_token } = await getMcpToken(cookie)
      const client = await connect(access_token, mode)
      const bug = await typeByPrefix(client, 'BUG')

      const { tools } = await client.listTools()
      // Agent tools are listed for everyone; the policy refuses them for Requesters, as REST does.
      for (const name of ['change_status', 'change_priority', 'assign_ticket']) {
        expect(tools.find(t => t.name === name)?.annotations, name).toMatchObject({ readOnlyHint: false, destructiveHint: false })
      }

      const result = await client.callTool({
        name: 'create_ticket',
        arguments: { ticket_type_id: bug.id, title: 'The export button fails', priority: 'high', fields: { page_or_feature: 'Reports', frequency: 'Sometimes' } },
      })
      expect(result.isError).toBeFalsy()
      const { number, ref } = result.structuredContent as { number: number, ref: string }
      expect(ref).toBe(`BUG-${number}`)
      await client.close()

      const read = await call(`/api/v1/tickets/${ref}`, { headers: { cookie } })
      expect(read.status).toBe(200)
      expect(await read.json()).toMatchObject({
        number, ref, title: 'The export button fails', priority: 'high', requester: { id: user.id }, channel: 'ai',
        schema_version: 1, fields: { page_or_feature: 'Reports', frequency: 'Sometimes' }, ticket_type: { prefix: 'BUG' }, status: { key: 'open' },
      })

      const list = await (await call('/api/v1/tickets?requester=me', { headers: { cookie } })).json() as { data: { ref: string }[] }
      expect(list.data.map(t => t.ref)).toContain(ref)
    })
  }

  it('returns a repairable error for a missing required Field, and a second call with the value succeeds', async () => {
    const { client } = await connected()
    const bug = await typeByPrefix(client, 'BUG')
    const first = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: bug.id, title: 'Export fails', fields: { frequency: 'Weekly' } } })
    expect(first.isError).toBe(true)
    const { problems } = first.structuredContent as { problems: Record<string, unknown>[] }
    expect(problems).toEqual([
      { key: 'page_or_feature', label: 'Page or feature', reason: 'Required.' },
      { key: 'frequency', label: 'How often does it happen?', reason: 'Must be one of the options.', options: ['Every time', 'Sometimes', 'Once'] },
    ])
    expect(JSON.stringify(first.content)).toContain('page_or_feature')

    const second = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: bug.id, title: 'Export fails', fields: { page_or_feature: 'Reports', frequency: 'Once' } } })
    expect(second.isError).toBeFalsy()
    await client.close()
  })

  it('returns a tool result, not a protocol error, for a bad title, Ticket Type, or Priority', async () => {
    const { client } = await connected()
    const bug = await typeByPrefix(client, 'BUG')
    const blank = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: bug.id, title: '   ', priority: 'soon', fields: { page_or_feature: 'x' } } })
    expect(blank.isError).toBe(true)
    expect((blank.structuredContent as { problems: { key: string, options?: string[] }[] }).problems).toEqual([
      expect.objectContaining({ key: 'title', reason: 'Title is required.' }),
      expect.objectContaining({ key: 'priority', options: ['low', 'normal', 'high', 'urgent'] }),
    ])
    // A schema violation (title absent) must not leave Claude without a way to repair the call.
    const absent = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: bug.id } }).catch((e: unknown) => e)
    expect(absent).toMatchObject({ isError: true })
    const unknown = await client.callTool({ name: 'create_ticket', arguments: { ticket_type_id: 99999, title: 'x' } })
    expect(unknown.isError).toBe(true)
    expect(JSON.stringify(unknown.content)).toContain('ticket_type_id')
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
