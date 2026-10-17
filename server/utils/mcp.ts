import { createResourceServerChallenge } from '@better-auth/oauth-provider'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { APIError } from 'better-auth/api'
import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { eq } from 'drizzle-orm'
import { errors as joseErrors, type JWTPayload } from 'jose'
import { z } from 'zod'
import { user } from '../db/schema'
import type { Role } from './auth'
import { config } from './env'
import { fieldsToJsonSchema } from './mcp-schema'
import { db, useAuth } from './services'
import { getTicketTypeWithFields, listTicketTypes } from './ticket-types'
import { createTicket, TicketValidationError, type Principal } from './tickets'

function buildServer(principal: Principal) {
  const server = new McpServer({ name: 'ticketing', version: '0.1.0' })

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

  server.registerTool('list_ticket_types', {
    title: 'List ticket types',
    description: 'List the Ticket Types with id, name, description and prefix. Call it first, then pick the type that fits what the user describes.',
    annotations: { title: 'List ticket types', ...readOnly },
  }, async () => {
    const types = (await listTicketTypes(db)).map(t => ({ id: t.id, name: t.name, description: t.description, prefix: t.prefix }))
    return { content: [{ type: 'text', text: JSON.stringify(types) }], structuredContent: { ticket_types: types } }
  })

  server.registerTool('get_ticket_type', {
    title: 'Get ticket type',
    description: 'Get the current Fields of one Ticket Type as JSON Schema. Property descriptions are the help text. Fill in the Fields you can infer from the conversation, and ask the user for the required ones you cannot.',
    inputSchema: z.object({ ticket_type_id: z.number().describe('The id from list_ticket_types.') }),
    annotations: { title: 'Get ticket type', ...readOnly },
  }, async ({ ticket_type_id }) => {
    const found = await getTicketTypeWithFields(db, ticket_type_id)
    if (!found) return { isError: true, content: [{ type: 'text', text: 'No Ticket Type has this id. Call list_ticket_types.' }] }
    const result = {
      id: found.id,
      name: found.name,
      description: found.description,
      prefix: found.prefix,
      schema_version: found.schema_version,
      fields_schema: fieldsToJsonSchema(found.fields),
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
  })

  server.registerTool('create_ticket', {
    title: 'Create ticket',
    description: 'Create a ticket for the signed-in user. Call list_ticket_types and get_ticket_type first. If the result lists problems, ask the user for exactly those values, then call again. Ask the user to confirm before you call it.',
    // Loose types on purpose: the module code validates and reports every problem, as a tool result.
    inputSchema: z.object({
      ticket_type_id: z.number().describe('The id from list_ticket_types.'),
      title: z.string().describe('A short summary.'),
      description: z.string().optional().describe('Details, in the words of the user.'),
      priority: z.string().optional().describe('low, normal (default), high or urgent.'),
      fields: z.record(z.string(), z.unknown()).optional().describe('Field values keyed by Field Key, as in the schema from get_ticket_type.'),
    }),
    annotations: { title: 'Create ticket', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    try {
      const created = await createTicket(db, principal, input)
      return {
        content: [{ type: 'text', text: `Created ${created.ref}: ${JSON.stringify(created.title)}` }],
        structuredContent: { number: created.number, ref: created.ref },
      }
    } catch (error) {
      if (error instanceof TicketValidationError) {
        const text = `The ticket was not created. Fix these problems and call create_ticket again: ${error.message}`
        return { isError: true, content: [{ type: 'text', text }], structuredContent: { problems: error.details } }
      }
      throw error
    }
  })

  return server
}

// Each request builds its own server, so no MCP session state exists (stateless Streamable HTTP).
// `legacy: 'stateless'` keeps serving the 2025 protocol, because Claude does not list 2026-07-28 yet.
const handler = createMcpHandler(({ authInfo }) => {
  const principal = authInfo?.extra?.principal as Principal | undefined
  if (!principal) throw new Error('MCP request reached the server without a verified principal')
  return buildServer(principal)
}, { legacy: 'stateless', responseMode: 'json' })

const jwksCacheKey = {}

function challenge(message: string): Response {
  const apiError = createResourceServerChallenge(new APIError('UNAUTHORIZED', { message }), config.mcpResource)!
  const headers = new Headers(apiError.headers)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), { status: 401, headers })
}

/**
 * Verifies the access token against the JWKS in our own database, then serves the MCP request.
 *
 * We do not use `requireMcpAuth`: it fetches the JWKS over HTTP from the base URL, and a Worker
 * should not fetch its own hostname. The checks are the same: signature, issuer, audience, expiry.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  if (!match) return challenge('missing bearer token')

  const auth = useAuth()
  let claims: JWTPayload
  try {
    claims = await verifyJwsAccessToken(match[1]!, {
      jwksFetch: () => auth.api.getJwks(),
      jwksCacheKey,
      verifyOptions: { issuer: `${config.appUrl}/api/auth`, audience: config.mcpResource },
    })
  } catch (error) {
    if (error instanceof joseErrors.JOSEError || (error instanceof Error && error.name === 'TypeError')) return challenge('invalid access token')
    throw error
  }
  // We cannot check a DPoP proof here, so a sender-constrained token is refused, not accepted as a bearer token.
  if (claims.cnf) return challenge('DPoP-bound access tokens are not supported')
  if (!claims.sub) return challenge('access token has no subject')

  const [row] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, claims.sub)).limit(1)
  if (!row) return challenge('user not found')

  const principal: Principal = { userId: row.id, role: row.role as Role, channel: 'ai' }
  return handler.fetch(request, {
    authInfo: {
      token: match[1]!,
      clientId: String(claims.azp ?? claims.client_id ?? ''),
      scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
      expiresAt: claims.exp,
      resource: new URL(config.mcpResource),
      extra: { principal },
    },
  })
}
