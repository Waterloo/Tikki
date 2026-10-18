import { createResourceServerChallenge } from '@better-auth/oauth-provider'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { APIError } from 'better-auth/api'
import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { eq } from 'drizzle-orm'
import { errors as joseErrors, type JWTPayload } from 'jose'
import { z } from 'zod'
import { PRIORITIES, team, user } from '../db/schema'
import { createComment, listComments } from './activity'
import { attachText, AttachmentError } from './attachments'
import type { Role } from './auth'
import { config, env } from './env'
import { fieldsToJsonSchema } from '../../shared/fields-schema'
import { NOT_FOUND, PolicyRefusal } from './policy'
import { limitMessage, takeToolSlot } from './rate-limit'
import { db, useAuth } from './services'
import { getTicketTypeWithFields, listTicketTypes } from './ticket-types'
import { changeTicketType } from './ticket-type-change'
import { createTicket, FIELD_KEY, getTicket, listTickets, loadFor, MAX_SEARCH_LENGTH, parseTicketReference, similarTickets, TicketValidationError, updateTicket, type ListFilter, type TicketDetail, type TicketSummary, type UserPrincipal } from './tickets'
import { createUploadLink } from './upload-links'
import { UNTRUSTED_NOTICE, untrusted, untrustedDeep } from '../../shared/untrusted'

// Small pages: the results go into the context of Claude.
const PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
// Newest comments first in the result; older ones are counted, not sent.
const COMMENT_LIMIT = 20

const name = (p: { name: string, email?: string }) => p.name || p.email || ''

function buildServer(principal: UserPrincipal) {
  const server = new McpServer({ name: 'ticketing', version: '0.1.0' })
  // Every tool call counts against the rate limits (DECISIONS 10). A tool without `readOnlyHint: true` counts as a write.
  type Register = (name: string, config: { annotations?: { readOnlyHint?: boolean } }, cb: (...args: unknown[]) => unknown) => unknown
  const register = server.registerTool.bind(server) as unknown as Register
  server.registerTool = ((name: string, config: Parameters<Register>[1], cb: Parameters<Register>[2]) => register(name, config, async (...args: unknown[]) => {
    const limited = await takeToolSlot(db, principal.userId, config.annotations?.readOnlyHint !== true)
    if (limited) {
      const text = `RATE_LIMITED: ${limitMessage('tool calls', limited)}`
      return { isError: true, content: [{ type: 'text' as const, text }], structuredContent: { error: { code: 'RATE_LIMITED', message: text, retry_after: limited.retryAfter } } }
    }
    return cb(...args)
  })) as unknown as typeof server.registerTool

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
    description: 'Create a ticket for the signed-in user. Call list_ticket_types and get_ticket_type first. If the result lists problems, ask the user for exactly those values, then call again. Ask the user to confirm before you call it. If similar open tickets exist, nothing is created: the result lists them. Ask the user whether to add a comment to one of them (add_comment) or to create a new ticket, and in that case call create_ticket again with the same arguments and confirm_new set to true.',
    // Loose types on purpose: the module code validates and reports every problem, as a tool result.
    inputSchema: z.object({
      ticket_type_id: z.number().describe('The id from list_ticket_types.'),
      title: z.string().describe('A short summary.'),
      description: z.string().optional().describe('Details, in the words of the user.'),
      priority: z.string().optional().describe('low, normal (default), high or urgent.'),
      fields: z.record(z.string(), z.unknown()).optional().describe('Field values keyed by Field Key, as in the schema from get_ticket_type.'),
      confirm_new: z.boolean().optional().describe('true after the user chose a new ticket although similar open tickets exist.'),
    }),
    annotations: { title: 'Create ticket', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ confirm_new, ...input }) => {
    try {
      // Same function and read rule as the web form; a title with no useful words finds nothing.
      const similar = confirm_new === true || typeof input.title !== 'string' ? [] : await similarTickets(db, principal, input.title)
      if (similar.length > 0) {
        const matches = similar.map(t => ({ ref: t.ref, title: untrusted(t.title), status: t.status.name }))
        const text = [
          'Nothing was created. These open tickets look similar:',
          ...matches.map(m => `${m.ref} (Status ${m.status}): ${m.title}`),
          UNTRUSTED_NOTICE,
          'Ask the user: add a comment to one of these tickets (call add_comment), or create a new ticket (call create_ticket again with the same arguments and confirm_new set to true).',
        ].join('\n')
        return { isError: false, content: [{ type: 'text', text }], structuredContent: { created: false, similar_tickets: matches } }
      }
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

  const ticketArg = z.string().describe('The Ticket Reference, for example BUG-12, or the ticket number.')
  const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }

  /** Runs a tool body and reports a policy refusal or a validation problem as a tool result, not a protocol error. */
  async function run(body: () => Promise<{ text: string, data: Record<string, unknown> }>) {
    try {
      const { text, data } = await body()
      return { content: [{ type: 'text' as const, text }], structuredContent: data }
    } catch (error) {
      if (error instanceof PolicyRefusal) {
        const { code, message } = error.refusal
        return { isError: true, content: [{ type: 'text' as const, text: `${code}: ${message}` }], structuredContent: { error: { code, message } } }
      }
      if (error instanceof AttachmentError) {
        return { isError: true, content: [{ type: 'text' as const, text: `${error.code}: ${error.message}` }], structuredContent: { error: { code: error.code, message: error.message } } }
      }
      if (error instanceof TicketValidationError) {
        return { isError: true, content: [{ type: 'text' as const, text: `Nothing changed. Fix these and try again: ${error.message}` }], structuredContent: { problems: error.details } }
      }
      throw error
    }
  }

  const numberOf = (ref: string) => {
    const number = parseTicketReference(ref)
    if (number === null) throw new PolicyRefusal(NOT_FOUND)
    return number
  }

  /** Runs one change through the same module function and policy as REST, and reports the result or the refusal. */
  function change(ref: string, input: Record<string, unknown>, apply: typeof updateTicket = updateTicket) {
    return run(async () => changed(await apply(db, principal, numberOf(ref), input)))
  }

  function changed(t: TicketDetail) {
    return {
      text: `${t.ref} (${t.ticket_type.name}): Status ${t.status.name}, Priority ${t.priority}, ${t.assignee ? `assigned to ${t.assignee.name || t.assignee.email}` : 'unassigned'}.`,
      data: { number: t.number, ref: t.ref, status: t.status.key, priority: t.priority, assignee_id: t.assignee?.id ?? null },
    }
  }

  const summary = (t: TicketSummary) => ({
    ref: t.ref,
    title: untrusted(t.title),
    status: t.status.key,
    priority: t.priority,
    type: t.ticket_type.name,
    team: t.team?.name,
    assignee: t.assignee ? name(t.assignee) : null,
    updated_at: t.updated_at,
  })

  /** One page of tickets, with the way to get the next one. */
  function page(tickets: TicketSummary[], nextCursor: string | null, tool: string) {
    const data = {
      notice: UNTRUSTED_NOTICE,
      tickets: tickets.map(summary),
      next_cursor: nextCursor,
      ...(nextCursor ? { more: `More tickets exist. Call ${tool} again with the same arguments and cursor set to next_cursor.` } : {}),
    }
    return { text: JSON.stringify(data), data }
  }

  const limitArg = z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`Page size, ${PAGE_SIZE} by default, at most ${MAX_PAGE_SIZE}.`)
  const cursorArg = z.string().max(200).optional().describe('The next_cursor of the previous page.')

  server.registerTool('list_my_tickets', {
    title: 'List my tickets',
    description: 'List the tickets the signed-in user asked for, newest activity first within each Status. Use it to answer "what is happening with my tickets?". Then call get_ticket for the details.',
    inputSchema: z.object({
      open_only: z.boolean().optional().describe('Only tickets that are not resolved or closed.'),
      limit: limitArg,
      cursor: cursorArg,
    }),
    annotations: { title: 'List my tickets', ...readOnly },
  }, ({ open_only, limit, cursor }) => run(async () => {
    const list = await listTickets(db, principal, { requesterIsMe: true, openOnly: open_only }, { cursor, limit: limit ?? PAGE_SIZE })
    return page(list.tickets, list.nextCursor, 'list_my_tickets')
  }))

  server.registerTool('get_ticket', {
    title: 'Get ticket',
    description: 'Get one ticket: Status, Priority, assignee, description, Field values, and the latest comments (Public Comments only, unless the user is an Agent).',
    inputSchema: z.object({ ticket: ticketArg }),
    annotations: { title: 'Get ticket', ...readOnly },
  }, ({ ticket }) => run(async () => {
    const number = numberOf(ticket)
    const [t, comments] = await Promise.all([getTicket(db, principal, number), listComments(db, principal, number)])
    const shown = comments.slice(-COMMENT_LIMIT)
    const data = {
      notice: UNTRUSTED_NOTICE,
      ...summary(t),
      requester: t.requester.kind === 'support' ? 'Support' : name(t.requester),
      description: untrusted(t.description),
      fields: untrustedDeep(t.fields),
      allowed_actions: t.allowed_actions,
      comments: shown.map(c => ({ visibility: c.visibility, author: c.author.kind === 'user' ? name(c.author) : c.author.kind === 'contact' ? `${c.author.contact.name} (Contact · ${c.author.application.name})` : c.author.kind === 'application' ? `${c.author.application.name} (Application)` : 'Support', created_at: c.created_at, body: untrusted(c.body) })),
      ...(comments.length > shown.length ? { older_comments_omitted: comments.length - shown.length } : {}),
    }
    return { text: JSON.stringify(data), data }
  }))

  server.registerTool('add_comment', {
    title: 'Add comment',
    description: 'Add a comment to one ticket. A Requester writes a Public Comment. An Agent writes an Internal Comment unless visibility is "public"; a Public Comment is seen by the Requester. Ask the user to confirm the text before you call it.',
    inputSchema: z.object({
      ticket: ticketArg,
      body: z.string().describe('The comment text.'),
      visibility: z.enum(['public', 'internal']).optional().describe('Agents only for "internal". Default: internal for Agents, public for Requesters.'),
    }),
    annotations: { title: 'Add comment', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ ticket, body, visibility }) => run(async () => {
    const c = await createComment(db, principal, numberOf(ticket), { body, visibility })
    return { text: `Added a ${c.visibility} comment to ${ticket}.`, data: { comment_id: c.id, visibility: c.visibility } }
  }))

  server.registerTool('attach_text', {
    title: 'Attach text',
    description: 'Attach text (a log, CSV, or stack trace, up to 256 KB) to one ticket as a file. Use a name such as "error.log" or "data.csv". For a binary file or a larger one, call request_upload_link instead. Ask the user to confirm before you call it.',
    inputSchema: z.object({
      ticket: ticketArg,
      filename: z.string().describe('The file name, for example "error.log". A name that ends in .csv is stored as CSV, anything else as plain text.'),
      content: z.string().describe('The text. At most 256 KB in UTF-8.'),
    }),
    annotations: { title: 'Attach text', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ ticket, filename, content }) => run(async () => {
    const a = await attachText(db, env.FILES, principal, numberOf(ticket), filename, content)
    return { text: `Attached ${JSON.stringify(a.filename)} (${a.size} bytes) to ${ticket}.`, data: { attachment_id: a.id, filename: a.filename, size: a.size, content_type: a.content_type } }
  }))

  server.registerTool('request_upload_link', {
    title: 'Request upload link',
    description: 'Get a link that the user opens in the browser to upload a file (an image or any binary file) to one ticket. The link works once, for 15 minutes, and only for the signed-in user. Give the link to the user and tell them to open it. Ask the user to confirm before you call it.',
    inputSchema: z.object({ ticket: ticketArg }),
    annotations: { title: 'Request upload link', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ ticket }) => run(async () => {
    const link = await createUploadLink(db, principal, numberOf(ticket))
    return {
      text: `Upload link for ${ticket}, valid until ${link.expiresAt}, one use only: ${link.url}`,
      data: { url: link.url, expires_at: link.expiresAt, single_use: true },
    }
  }))

  server.registerTool('search_tickets', {
    title: 'Search tickets',
    description: 'Search the tickets the user may see. Words must all match the title or description, or give a Ticket Reference. Use the filters to narrow the result. Returns one page; follow next_cursor for more.',
    inputSchema: z.object({
      query: z.string().max(MAX_SEARCH_LENGTH).optional().describe('Words, or a Ticket Reference such as BUG-12.'),
      ticket_type_id: z.number().int().positive().optional().describe('The id from list_ticket_types.'),
      priority: z.enum(PRIORITIES).optional(),
      assignee: z.string().min(1).max(100).optional().describe('"me", "none", or a User id.'),
      open_only: z.boolean().optional().describe('Only tickets that are not resolved or closed.'),
      fields: z.record(z.string().regex(FIELD_KEY), z.string().max(200)).optional().describe('Exact Field values keyed by Field Key, for example {"branch": "Singapore"}.'),
      limit: limitArg,
      cursor: cursorArg,
    }),
    annotations: { title: 'Search tickets', ...readOnly },
  }, ({ query, ticket_type_id, priority, assignee, open_only, fields, limit, cursor }) => run(async () => {
    const filter: ListFilter = {
      search: query,
      ticketTypeId: ticket_type_id,
      priority,
      assignee,
      openOnly: open_only,
      fields: Object.entries(fields ?? {}).map(([key, value]) => ({ key, value })),
    }
    const list = await listTickets(db, principal, filter, { cursor, limit: limit ?? PAGE_SIZE })
    return page(list.tickets, list.nextCursor, 'search_tickets')
  }))

  server.registerTool('change_status', {
    title: 'Change ticket Status',
    description: 'Agents only. Set the Status of one ticket, for example in_progress, waiting, resolved, or closed. Ask the user to confirm before you call it.',
    inputSchema: z.object({ ticket: ticketArg, status: z.string().describe('The Status key, for example in_progress. An unknown key returns the list of keys.') }),
    annotations: { title: 'Change ticket Status', ...writeAnnotations },
  }, ({ ticket, status }) => change(ticket, { status }))

  server.registerTool('change_priority', {
    title: 'Change ticket Priority',
    description: 'Agents only. Set the Priority of one ticket. Ask the user to confirm before you call it.',
    inputSchema: z.object({ ticket: ticketArg, priority: z.enum(PRIORITIES) }),
    annotations: { title: 'Change ticket Priority', ...writeAnnotations },
  }, ({ ticket, priority }) => change(ticket, { priority }))

  server.registerTool('assign_ticket', {
    title: 'Assign ticket',
    description: 'Agents only. Assign one ticket to the signed-in user ("me"), to an active Agent or Admin by email, or remove the assignee ("none"). Moving a ticket to another Team keeps the assignee. Ask the user to confirm before you call it.',
    inputSchema: z.object({ ticket: ticketArg, assignee: z.string().min(1).max(320).describe('"me", "none", or the email of an active Agent or Admin.') }),
    annotations: { title: 'Assign ticket', ...writeAnnotations },
  }, ({ ticket, assignee }) => {
    const wanted = assignee.trim().toLowerCase()
    if (wanted === 'me') return change(ticket, { assignee_id: principal.userId })
    if (wanted === 'none' || wanted === 'nobody') return change(ticket, { assignee_id: null })
    // The policy answers first, so a Requester gets the same refusal as on REST. An unknown email then fails like an unknown ID.
    return run(async () => {
      const number = numberOf(ticket)
      await loadFor(db, principal, 'assign', number)
      const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, wanted)).limit(1)
      // An email is never a User ID, so a missing User fails the same check as on REST.
      return changed(await updateTicket(db, principal, number, { assignee_id: found?.id ?? wanted }))
    })
  })

  server.registerTool('move_ticket_team', {
    title: 'Move ticket to a Team',
    description: 'Agents only. Move one ticket to another Team by name, for example from Support to Development. The assignee stays. The members of the new Team get a notice. Ask the user to confirm before you call it.',
    inputSchema: z.object({ ticket: ticketArg, team: z.string().min(1).max(100).describe('The name of the Team.') }),
    annotations: { title: 'Move ticket to a Team', ...writeAnnotations },
  }, ({ ticket, team: teamName }) => run(async () => {
    const number = numberOf(ticket)
    await loadFor(db, principal, 'move_team', number)
    const teams = await db.select({ id: team.id, name: team.name }).from(team)
    const found = teams.find(t => t.name.toLowerCase() === teamName.trim().toLowerCase())
    if (!found) throw new TicketValidationError([{ key: 'team', label: 'Team', reason: `No Team has this name. Teams: ${teams.map(t => t.name).join(', ') || 'none'}.` }])
    const t = await updateTicket(db, principal, number, { team_id: found.id })
    return { text: `${t.ref} is in the Team ${t.team?.name}.`, data: { number: t.number, ref: t.ref, team: t.team?.name ?? null } }
  }))

  server.registerTool('change_ticket_type', {
    title: 'Change ticket type',
    description: 'Agents only. Move one ticket to another Ticket Type, for example when it was filed as the wrong kind. The number stays and the prefix changes, so the old reference still works. Values of Fields with the same key and data type move; the others stay in the Activity. The Team changes to the Team of the new type. Ask the user to confirm before you call it.',
    inputSchema: z.object({ ticket: ticketArg, ticket_type_id: z.number().describe('The id from list_ticket_types.') }),
    annotations: { title: 'Change ticket type', ...writeAnnotations },
  }, ({ ticket, ticket_type_id }) => change(ticket, { ticket_type_id }, changeTicketType))

  return server
}

// Each request builds its own server, so no MCP session state exists (stateless Streamable HTTP).
// `legacy: 'stateless'` keeps serving the 2025 protocol, because Claude does not list 2026-07-28 yet.
const handler = createMcpHandler(({ authInfo }) => {
  const principal = authInfo?.extra?.principal as UserPrincipal | undefined
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

  const [row] = await db.select({ id: user.id, role: user.role, deactivatedAt: user.deactivatedAt }).from(user).where(eq(user.id, claims.sub)).limit(1)
  if (!row) return challenge('user not found')
  // The JWT is valid until it expires, so a deactivated User must be stopped here (3.18, ADR 0003).
  if (row.deactivatedAt) return challenge('user is deactivated')

  const principal: UserPrincipal = { kind: 'user', userId: row.id, role: row.role as Role, channel: 'ai' }
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
