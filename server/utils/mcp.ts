import { createResourceServerChallenge } from '@better-auth/oauth-provider'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { APIError } from 'better-auth/api'
import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { eq } from 'drizzle-orm'
import { errors as joseErrors, type JWTPayload } from 'jose'
import { user } from '../db/schema'
import type { Role } from './auth'
import { config } from './env'
import { db, useAuth } from './services'
import { createTicket, newTicketInput, TicketValidationError, type Principal } from './tickets'

function buildServer(principal: Principal) {
  const server = new McpServer({ name: 'ticketing', version: '0.1.0' })

  server.registerTool('create_ticket', {
    title: 'Create ticket',
    description: 'Create a ticket for the signed-in user. Use it when the user reports a problem or asks for something. Ask the user to confirm before you call it.',
    inputSchema: newTicketInput,
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
        return { isError: true, content: [{ type: 'text', text: `The ticket was not created. Fix these and try again: ${error.message}` }] }
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
