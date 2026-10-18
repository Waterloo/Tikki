/**
 * The WebMCP tools of the page (issue 36), without Nuxt: `useWebMcpTools` registers them. Each tool calls the REST
 * API, so the server alone decides what the User may read and do. Results have the fields and wording of the
 * `/mcp` tool that each one mirrors (server/utils/mcp.ts).
 */
import { fieldsToJsonSchema, type SchemaField } from '../../shared/fields-schema'
import { UNTRUSTED_NOTICE, untrusted, untrustedDeep } from '../../shared/untrusted'
import type { Attachment, CommentView, TicketDetail, TicketSummary } from '../types/tickets'

export interface ToolResult {
  content: { type: 'text', text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export interface PageTool {
  name: string
  description: string
  inputSchema: JsonSchema
  annotations: { readOnlyHint?: boolean, untrustedContentHint?: boolean, consequentialHint?: boolean }
  execute: (input: unknown) => Promise<ToolResult>
}

/** What the tools need from the page. Injected, so the unit tests run without Nuxt. */
export interface ToolDeps {
  /** `$fetch` with `X-Tikki-Channel: ai`. */
  api: <T>(url: string, init?: { method: 'POST' | 'PATCH', body: Record<string, unknown> }) => Promise<T>
  /** The ticket page that is open, or null. */
  current: () => { ref: string, hasDraft: () => boolean } | null
  navigate: (path: string) => Promise<unknown>
  /** True after the ticket page shows `ref` and its tools are registered; false after `timeoutMs`. */
  shown: (ref: string, timeoutMs: number) => Promise<boolean>
}

/** What the ticket page does after a tool changed its ticket. */
export interface TicketPage {
  changed: (ticket?: TicketDetail) => void
}

interface JsonSchema {
  type?: 'object' | 'string' | 'boolean' | 'integer' | 'number'
  description?: string
  enum?: readonly string[]
  minimum?: number
  maximum?: number
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
}

// Same page sizes as `/mcp`.
const PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const COMMENT_LIMIT = 20
const OPEN_TIMEOUT_MS = 10_000

const CONFIRM = 'Ask the user to confirm before you call it.'
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

const name = (p: { name: string, email?: string }) => p.name || p.email || ''

const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema =>
  ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false })

/** The input problems against a tool's own schema. A WebMCP client is not required to validate. */
function inputProblems(schema: JsonSchema, input: unknown): string[] {
  const value = input ?? {}
  if (typeof value !== 'object' || Array.isArray(value)) return ['The input must be an object.']
  const props = schema.properties ?? {}
  const problems: string[] = []
  for (const [key, v] of Object.entries(value)) {
    const prop = props[key]
    if (!prop) problems.push(`Unknown input "${key}". Allowed: ${Object.keys(props).join(', ') || 'none'}.`)
    else if (v !== undefined) problems.push(...valueProblems(key, prop, v))
  }
  for (const key of schema.required ?? []) {
    if ((value as Record<string, unknown>)[key] === undefined) problems.push(`"${key}" is required.`)
  }
  return problems
}

function valueProblems(key: string, schema: JsonSchema, v: unknown): string[] {
  const ok = schema.type === 'integer'
    ? Number.isSafeInteger(v)
    : schema.type === 'object' ? typeof v === 'object' && v !== null && !Array.isArray(v) : typeof v === schema.type
  if (!ok) return [`"${key}" must be ${schema.type === 'integer' ? 'an integer' : `a ${schema.type}`}.`]
  if (schema.enum && !schema.enum.includes(v as string)) return [`"${key}" must be one of: ${schema.enum.join(', ')}.`]
  if (typeof v === 'number' && ((schema.minimum !== undefined && v < schema.minimum) || (schema.maximum !== undefined && v > schema.maximum))) {
    return [`"${key}" must be from ${schema.minimum} to ${schema.maximum}.`]
  }
  if (typeof schema.additionalProperties === 'object') {
    const inner = schema.additionalProperties
    return Object.entries(v as object).flatMap(([k, x]) => valueProblems(`${key}.${k}`, inner, x))
  }
  return []
}

const text = (t: string, data?: Record<string, unknown>, isError?: boolean): ToolResult =>
  ({ ...(isError !== undefined ? { isError } : {}), content: [{ type: 'text', text: t }], ...(data ? { structuredContent: data } : {}) })

/** A refusal in the shape of `run()` in mcp.ts (5.11). */
function toolError(code: string, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return text(`${code}: ${message}`, { error: { code, message, ...extra } }, true)
}

interface FieldProblem { key: string, label?: string, reason: string, options?: string[] }

/** The same text as `TicketValidationError` on the server. */
const problemsText = (details: FieldProblem[]) =>
  details.map(d => `${d.key}${d.label ? ` (${d.label})` : ''}: ${d.reason}${d.options ? ` Options: ${d.options.join(', ')}.` : ''}`).join(' ')

/** A REST error (6.4) as a tool result. A network error or a bug is thrown on, so it fails visibly. */
function restFailure(e: unknown, invalid = 'Nothing changed. Fix these and try again: '): ToolResult {
  const err = e as { status?: number, data?: { error?: { code?: string, message?: string, details?: unknown } }, response?: { headers?: Headers } }
  const body = err.data?.error
  if (!err.status || !body?.code) throw e
  if (body.code === 'VALIDATION_FAILED' && Array.isArray(body.details)) {
    return text(`${invalid}${problemsText(body.details as FieldProblem[])}`, { problems: body.details }, true)
  }
  const retryAfter = Number(err.response?.headers?.get('retry-after'))
  return toolError(body.code, body.message ?? '', body.code === 'RATE_LIMITED' && retryAfter > 0 ? { retry_after: retryAfter } : {})
}

/** Checks the input, runs the tool, and reports a REST error as a tool result. */
function tool(def: Omit<PageTool, 'execute'>, body: (input: Record<string, unknown>) => Promise<ToolResult>, invalid?: string): PageTool {
  return {
    ...def,
    async execute(input) {
      const problems = inputProblems(def.inputSchema, input)
      if (problems.length) return toolError('INVALID_INPUT', problems.join(' '))
      try {
        return await body((input ?? {}) as Record<string, unknown>)
      } catch (e) {
        return restFailure(e, invalid)
      }
    },
  }
}

const json = (data: Record<string, unknown>) => text(JSON.stringify(data), data)

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

const author = (a: CommentView['author']) =>
  a.kind === 'user' ? name(a) : a.kind === 'contact' ? `${a.contact.name} (Contact · ${a.application.name})` : 'Support'

const enc = encodeURIComponent

const SEARCH_SCHEMA = object({
  query: { type: 'string', description: 'Words, or a Ticket Reference such as BUG-12.' },
  mine: { type: 'boolean', description: 'Only tickets the user asked for (the user is the Requester).' },
  assignee: { type: 'string', description: '"me", "none", or a User id.' },
  ticket_type_id: { type: 'integer', minimum: 1, description: 'The id from get_ticket_types.' },
  team_id: { type: 'integer', minimum: 1, description: 'The id of the ticket\'s Team.' },
  priority: { type: 'string', enum: PRIORITIES },
  fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Exact Field values keyed by Field Key, for example {"branch": "Singapore"}.' },
  open_only: { type: 'boolean', description: 'Only tickets that are not resolved or closed.' },
  limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, description: `Page size, ${PAGE_SIZE} by default, at most ${MAX_PAGE_SIZE}.` },
  cursor: { type: 'string', description: 'The next_cursor of the previous page.' },
})

/** The query string of `GET /api/v1/tickets` for the `search_tickets` input. The input must be valid. */
function searchQuery(input: Record<string, unknown>): string {
  const q = new URLSearchParams()
  if (input.query !== undefined) q.set('q', String(input.query))
  if (input.mine === true) q.set('requester', 'me')
  if (input.assignee !== undefined) q.set('assignee', String(input.assignee))
  if (input.ticket_type_id !== undefined) q.set('type', String(input.ticket_type_id))
  if (input.team_id !== undefined) q.set('team', String(input.team_id))
  if (input.priority !== undefined) q.set('priority', String(input.priority))
  for (const [key, value] of Object.entries((input.fields ?? {}) as Record<string, string>)) q.append('field', `${key}:${value}`)
  if (input.open_only === true) q.set('open', 'true')
  q.set('limit', String(input.limit ?? PAGE_SIZE))
  if (input.cursor !== undefined) q.set('cursor', String(input.cursor))
  return q.toString()
}

/** The tools on every signed-in page. */
export function webMcpPageTools(deps: ToolDeps): PageTool[] {
  const { api } = deps
  return [
    tool({
      name: 'search_tickets',
      description: 'Search the tickets the user may see. Words must all match the title or description, or give a Ticket Reference. Use the filters to narrow the result. There is no Status filter: filter the summaries by status yourself. Returns one page of summaries; follow next_cursor for more. To read a ticket, call open_ticket.',
      inputSchema: SEARCH_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    }, async (input) => {
      const list = await api<{ data: TicketSummary[], next_cursor: string | null }>(`/api/v1/tickets?${searchQuery(input)}`)
      return json({
        notice: UNTRUSTED_NOTICE,
        tickets: list.data.map(summary),
        next_cursor: list.next_cursor,
        ...(list.next_cursor ? { more: 'More tickets exist. Call search_tickets again with the same arguments and cursor set to next_cursor.' } : {}),
      })
    }),

    tool({
      name: 'open_ticket',
      description: 'Open one ticket in the user\'s tab, so that the user sees it. Then call get_current_ticket to read it. If the user has an unsent reply on the open ticket, nothing happens: ask the user first.',
      inputSchema: object({ ref: { type: 'string', description: 'The Ticket Reference, for example BUG-12, or the ticket number.' } }, ['ref']),
      annotations: { readOnlyHint: true },
    }, async ({ ref }) => {
      const t = await api<TicketDetail>(`/api/v1/tickets/${enc(String(ref))}`)
      const opened = () => json({ notice: UNTRUSTED_NOTICE, ref: t.ref, title: untrusted(t.title), status: t.status.key })
      const current = deps.current()
      if (current?.ref === t.ref) return opened()
      // The ticket page has no leave guard: a navigation would lose the text.
      if (current?.hasDraft()) return toolError('DRAFT_OPEN', `The user has an unsent reply on ${current.ref}. Ask the user first.`)
      await deps.navigate(`/tickets/${enc(t.ref)}`)
      if (!await deps.shown(t.ref, OPEN_TIMEOUT_MS)) return toolError('TIMEOUT', `The page did not show ${t.ref} within ${OPEN_TIMEOUT_MS / 1000} seconds.`)
      return opened()
    }),

    tool({
      name: 'get_ticket_types',
      description: 'Without ticket_type_id: list the Ticket Types with id, name, description and prefix. Pick the type that fits what the user describes. With ticket_type_id: get the current Fields of that type as JSON Schema. Property descriptions are the help text. Fill in the Fields you can infer from the conversation, and ask the user for the required ones you cannot.',
      inputSchema: object({ ticket_type_id: { type: 'integer', minimum: 1, description: 'The id from the list.' } }),
      annotations: { readOnlyHint: true },
    }, async ({ ticket_type_id }) => {
      if (ticket_type_id === undefined) {
        const { data } = await api<{ data: { id: number, name: string, description: string, prefix: string }[] }>('/api/v1/ticket-types')
        return json({ ticket_types: data.map(t => ({ id: t.id, name: t.name, description: t.description, prefix: t.prefix })) })
      }
      const found = await api<{ id: number, name: string, description: string, prefix: string, schema_version: number, fields: SchemaField[] }>(`/api/v1/ticket-types/${ticket_type_id}`)
      return json({
        id: found.id,
        name: found.name,
        description: found.description,
        prefix: found.prefix,
        schema_version: found.schema_version,
        fields_schema: fieldsToJsonSchema(found.fields),
      })
    }),

    tool({
      name: 'create_ticket',
      description: `Create a ticket for the signed-in user. Call get_ticket_types first, without and then with ticket_type_id. If the result lists problems, ask the user for exactly those values, then call again. If similar open tickets exist, nothing is created: the result lists them. Ask the user whether to add a comment to one of them (open_ticket, then add_comment_to_current_ticket) or to create a new ticket, and in that case call create_ticket again with the same arguments and confirm_new set to true. ${CONFIRM}`,
      inputSchema: object({
        ticket_type_id: { type: 'integer', description: 'The id from get_ticket_types.' },
        title: { type: 'string', description: 'A short summary.' },
        description: { type: 'string', description: 'Details, in the words of the user.' },
        priority: { type: 'string', enum: PRIORITIES, description: 'low, normal (default), high or urgent.' },
        fields: { type: 'object', description: 'Field values keyed by Field Key, as in the schema from get_ticket_types.' },
        confirm_new: { type: 'boolean', description: 'true after the user chose a new ticket although similar open tickets exist.' },
      }, ['ticket_type_id', 'title']),
      annotations: { consequentialHint: true },
    }, async ({ confirm_new, ...input }) => {
      // Same check as the web form and `/mcp` (5.17): POST /api/v1/tickets does not look for duplicates.
      if (confirm_new !== true) {
        const { data } = await api<{ data: TicketSummary[] }>(`/api/v1/tickets/similar?title=${enc(String(input.title))}`)
        if (data.length > 0) {
          const matches = data.map(t => ({ ref: t.ref, title: untrusted(t.title), status: t.status.name }))
          return text([
            'Nothing was created. These open tickets look similar:',
            ...matches.map(m => `${m.ref} (Status ${m.status}): ${m.title}`),
            UNTRUSTED_NOTICE,
            'Ask the user: add a comment to one of these tickets (call open_ticket, then add_comment_to_current_ticket), or create a new ticket (call create_ticket again with the same arguments and confirm_new set to true).',
          ].join('\n'), { created: false, similar_tickets: matches }, false)
        }
      }
      const created = await api<TicketDetail>('/api/v1/tickets', { method: 'POST', body: input })
      return text(`Created ${created.ref}: ${JSON.stringify(created.title)}`, { number: created.number, ref: created.ref })
    }, 'The ticket was not created. Fix these problems and call create_ticket again: '),
  ]
}

/** The tools for the ticket that the page shows. They take no ticket argument, so they cannot act on another one. */
export function webMcpTicketTools(ticket: TicketDetail, deps: ToolDeps, page: TicketPage): PageTool[] {
  const { api } = deps
  const base = `/api/v1/tickets/${enc(ticket.ref)}`
  const tools = [
    tool({
      name: 'get_current_ticket',
      description: 'Get the ticket that the user sees in this tab: Status, Priority, assignee, description, Field values, attachment names, and the latest comments (Public Comments only, unless the user is an Agent). To read another ticket, call open_ticket first.',
      inputSchema: object({}),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    }, async () => {
      const [t, comments, files] = await Promise.all([
        api<TicketDetail>(base),
        api<{ data: CommentView[] }>(`${base}/comments`).then(r => r.data),
        api<{ data: Attachment[] }>(`${base}/attachments`).then(r => r.data),
      ])
      const shown = comments.slice(-COMMENT_LIMIT)
      return json({
        notice: UNTRUSTED_NOTICE,
        ...summary(t),
        requester: name(t.requester),
        description: untrusted(t.description),
        fields: untrustedDeep(t.fields),
        allowed_actions: t.allowed_actions,
        comments: shown.map(c => ({ visibility: c.visibility, author: author(c.author), created_at: c.created_at, body: untrusted(c.body) })),
        ...(comments.length > shown.length ? { older_comments_omitted: comments.length - shown.length } : {}),
        attachments: files.map(f => untrusted(f.filename)),
      })
    }),

    tool({
      name: 'add_comment_to_current_ticket',
      description: `Add a comment to the ticket that the user sees in this tab. A Requester writes a Public Comment. An Agent writes an Internal Comment unless visibility is "public"; a Public Comment is seen by the Requester. ${CONFIRM}`,
      inputSchema: object({
        body: { type: 'string', description: 'The comment text.' },
        visibility: { type: 'string', enum: ['public', 'internal'], description: 'Agents only for "internal". Default: internal for Agents, public for Requesters.' },
      }, ['body']),
      annotations: { consequentialHint: true },
    }, async ({ body, visibility }) => {
      const c = await api<CommentView>(`${base}/comments`, { method: 'POST', body: { body, ...(visibility ? { visibility } : {}) } })
      page.changed()
      return text(`Added a ${c.visibility} comment to ${ticket.ref}.`, { comment_id: c.id, visibility: c.visibility })
    }),
  ]
  if (!ticket.allowed_actions.includes('change_status')) return tools
  return [...tools, tool({
    name: 'change_current_ticket_status',
    description: `Set the Status of the ticket that the user sees in this tab, for example in_progress, waiting, resolved, or closed. ${CONFIRM}`,
    inputSchema: object({ status: { type: 'string', description: 'The Status key, for example in_progress. An unknown key returns the list of keys.' } }, ['status']),
    annotations: { consequentialHint: true },
  }, async ({ status }) => {
    const t = await api<TicketDetail>(base, { method: 'PATCH', body: { status } })
    page.changed(t)
    return text(
      `${t.ref} (${t.ticket_type.name}): Status ${t.status.name}, Priority ${t.priority}, ${t.assignee ? `assigned to ${t.assignee.name || t.assignee.email}` : 'unassigned'}.`,
      { number: t.number, ref: t.ref, status: t.status.key, priority: t.priority, assignee_id: t.assignee?.id ?? null },
    )
  })]
}
