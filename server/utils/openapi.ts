import { z } from 'zod'
import { FIELD_TYPES, type FieldError } from './fields'
import { CHANNELS, PRIORITIES, STATUS_CATEGORIES, TICKET_VISIBILITIES } from '../db/schema'
import { TICKET_ACTIONS } from './policy'
import type { TicketTypeView, TicketTypeWithFields } from './ticket-types'
import { applicationTicketInput } from './ticket-input'
import type { TicketDetail, TicketSummary } from './tickets'

/**
 * The OpenAPI document of the API for Applications (6.2). Requests use the zod schemas that validate them.
 * The response schemas are checked against the response interfaces below, so a changed view fails `typecheck`.
 */

const statusOut = z.object({ key: z.string(), name: z.string(), category: z.enum(STATUS_CATEGORIES) })
const person = z.object({ id: z.string(), name: z.string(), email: z.string() })
const requesterOut = z.discriminatedUnion('kind', [
  person.extend({ kind: z.literal('user') }),
  z.object({ kind: z.literal('contact'), id: z.number().int(), external_id: z.string(), name: z.string(), email: z.string() }),
])

const ticketSummaryOut = z.object({
  number: z.number().int().describe('The Ticket Number. It never changes; store this one (4.9c).'),
  ref: z.string().describe('The Ticket Reference for display, for example PAY-1048. It changes with the Ticket Type.'),
  title: z.string(),
  priority: z.enum(PRIORITIES),
  status: statusOut,
  ticket_type: z.object({ id: z.number().int(), name: z.string(), prefix: z.string(), icon: z.string(), color: z.string() }),
  requester: requesterOut,
  assignee: person.nullable().describe('Always null for an Application. Use `assigned`.'),
  assigned: z.boolean().describe('Whether a staff member is assigned. Their name is not shared.'),
  team: z.object({ id: z.number().int(), name: z.string() }).optional().describe('The ticket\'s Team. Left out for an Application: staff structure is private.'),
  channel: z.enum(CHANNELS),
  application: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
})

const ticketDetailOut = ticketSummaryOut.extend({
  description: z.string(),
  schema_version: z.number().int(),
  fields: z.record(z.string(), z.unknown()).describe('Field values keyed by Field Key.'),
  schema_fields: z.array(z.object({
    key: z.string(), label: z.string(), type: z.enum(FIELD_TYPES), required: z.boolean(), help: z.string(),
    options: z.array(z.string()).optional().describe('The active options of a select Field.'),
  })),
  comment_count: z.number().int().describe('The comments the caller can see. An Application never sees Internal Comments.'),
  reopened_from: z.object({ number: z.number().int(), ref: z.string() }).nullable(),
  allowed_actions: z.array(z.enum(TICKET_ACTIONS)),
  restricted: z.boolean().describe('Always false for an Application: it never sees a Restricted ticket.'),
})

const ticketTypeOut = z.object({
  id: z.number().int().describe('Send this as `ticket_type_id`.'),
  name: z.string(),
  description: z.string().describe('When to use this type.'),
  icon: z.string(),
  color: z.string(),
  prefix: z.string(),
  team: z.object({ id: z.number().int(), name: z.string() }),
  visibility: z.enum(TICKET_VISIBILITIES).describe('Who sees its tickets. An Application never gets a `participants` type.'),
})

const ticketTypeWithFieldsOut = ticketTypeOut.extend({
  schema_version: z.number().int(),
  fields: z.array(z.object({
    key: z.string().describe('The Field Key. Use it in `fields` of a new ticket.'),
    label: z.string(),
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    help: z.string(),
    options: z.array(z.string()).optional(),
  })),
})

const fieldErrorOut = z.object({ key: z.string(), label: z.string(), reason: z.string(), options: z.array(z.string()).optional() })

const errorOut = z.object({
  error: z.object({
    code: z.string().describe('Stable, for code: for example NOT_FOUND, FORBIDDEN, VALIDATION_FAILED, IDEMPOTENCY_KEY_REUSED.'),
    message: z.string().describe('For people.'),
    details: z.array(fieldErrorOut).nullable().describe('For VALIDATION_FAILED: one entry for each problem.'),
  }),
})

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
// Each entry must be `true`: the schema and the interface describe the same object.
const schemasMatchViews: [
  Same<z.output<typeof ticketSummaryOut>, TicketSummary>,
  Same<z.output<typeof ticketDetailOut>, TicketDetail>,
  Same<z.output<typeof ticketTypeOut>, TicketTypeView>,
  Same<z.output<typeof ticketTypeWithFieldsOut>, TicketTypeWithFields>,
  Same<z.output<typeof fieldErrorOut>, FieldError>,
] = [true, true, true, true, true]
void schemasMatchViews

function schema(type: z.ZodType, io: 'input' | 'output') {
  const { $schema: _, ...rest } = z.toJSONSchema(type, { io, unrepresentable: 'any' }) as Record<string, unknown>
  return rest
}

/** The schemas, for the test that parses every example with the schema it shows. */
export const openApiSchemas = {
  TicketCreate: applicationTicketInput,
  Ticket: ticketDetailOut,
  TicketSummary: ticketSummaryOut,
  TicketType: ticketTypeOut,
  TicketTypeWithFields: ticketTypeWithFieldsOut,
  Error: errorOut,
}
type SchemaName = keyof typeof openApiSchemas

// --- Examples (shown in the docs at /docs/api) ------------------------------------------------------------------------

const ticketTypeExample = { id: 3, name: 'Payment issue', description: 'A charge, refund or invoice is wrong.', icon: 'credit-card', color: '#A14B00', prefix: 'PAY', team: { id: 2, name: 'Billing' }, visibility: 'requester' }
const summaryExample = {
  number: 1048,
  ref: 'PAY-1048',
  title: 'Charged twice for order 5521',
  priority: 'high',
  status: { key: 'open', name: 'Open', category: 'open' },
  ticket_type: { id: 3, name: 'Payment issue', prefix: 'PAY', icon: 'credit-card', color: '#A14B00' },
  requester: { kind: 'contact', id: 77, external_id: 'cus_19ab', name: 'Jo Park', email: 'jo@example.org' },
  assignee: null,
  assigned: false,
  channel: 'api',
  application: { id: 1, name: 'Checkout site' },
  created_at: '2026-10-18T09:12:44.000Z',
  updated_at: '2026-10-18T09:12:44.000Z',
}
const fieldsExample = [
  { key: 'order_id', label: 'Order ID', type: 'short_text', required: true, help: 'The number on the receipt.' },
  { key: 'amount', label: 'Amount', type: 'short_text', required: false, help: '' },
]
const ticketExample = {
  ...summaryExample,
  description: 'I see two charges of 49.00 on my card.',
  schema_version: 2,
  fields: { order_id: '5521', amount: '49.00' },
  schema_fields: fieldsExample,
  comment_count: 0,
  reopened_from: null,
  allowed_actions: ['read', 'comment'],
  restricted: false,
}
const createExample = {
  ticket_type_id: 3,
  title: 'Charged twice for order 5521',
  description: 'I see two charges of 49.00 on my card.',
  priority: 'high',
  fields: { order_id: '5521', amount: '49.00' },
  contact: { external_id: 'cus_19ab', name: 'Jo Park', email: 'jo@example.org' },
}
const errorExample = (code: string, message: string, details: unknown[] | null = null) => ({ error: { code, message, details } })

const ref = (name: SchemaName) => ({ $ref: `#/components/schemas/${name}` })
const json = (name: SchemaName, example?: unknown) => ({ 'application/json': { schema: ref(name), ...(example === undefined ? {} : { example }) } })
const error = (description: string, example?: ReturnType<typeof errorExample>) => ({ description, content: json('Error', example) })
const unauthorized = () => error('The API key is missing, unknown, or revoked.', errorExample('UNAUTHENTICATED', 'The API key is not valid. It may be revoked. Send it as "Authorization: Bearer gt_live_...".'))

/** Runs at build time (nuxt.config.ts), so no request pays for `z.toJSONSchema`. */
export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Ticketing API',
      version: '1',
      description: 'Create and read tickets for your Contacts with an API key. An Application sees only the tickets it created, and never Internal Comments.',
    },
    servers: [{ url: '/' }],
    security: [{ apiKey: [] }],
    tags: [
      { name: 'Tickets', description: 'Tickets of this Application\'s Contacts.' },
      { name: 'Ticket Types', description: 'The types this Application may use, and their Fields.' },
      { name: 'Contacts', description: 'The people an Application creates tickets for.' },
    ],
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', description: 'An API key of an Application: `Authorization: Bearer gt_live_...`.' },
      },
      schemas: {
        TicketCreate: schema(applicationTicketInput, 'input'),
        Ticket: schema(ticketDetailOut, 'output'),
        TicketSummary: schema(ticketSummaryOut, 'output'),
        TicketType: schema(ticketTypeOut, 'output'),
        TicketTypeWithFields: schema(ticketTypeWithFieldsOut, 'output'),
        Error: schema(errorOut, 'output'),
      },
    },
    paths: {
      '/api/v1/tickets': {
        post: {
          operationId: 'createTicket',
          tags: ['Tickets'],
          summary: 'Create a ticket for a Contact',
          description: 'Needs `tickets:create`, and the Ticket Type must be in the allowed list. `fields` are checked against the Fields of the type (GET /api/v1/ticket-types/{id}). The Contact is found by `external_id` and gets the name and email sent.',
          parameters: [{
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string', minLength: 1, maxLength: 255 },
            example: 'order-5521',
            description: 'A repeat with the same key in 24 hours returns the first ticket, with the header `Idempotent-Replayed: true`, and creates nothing. The same key with another body answers 409.',
          }],
          requestBody: { required: true, content: json('TicketCreate', createExample) },
          responses: {
            201: { description: 'The ticket.', content: json('Ticket', ticketExample) },
            400: error('The body is not JSON, or the Idempotency-Key is not valid.'),
            401: unauthorized(),
            403: error('The Application is disabled, has no `tickets:create`, or may not use this Ticket Type.'),
            409: error('The Idempotency-Key was used with another body.', errorExample('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with another request body in the last 24 hours. Use a new key for a new ticket.')),
            422: error('The body has invalid values. `details` lists each problem.', errorExample('VALIDATION_FAILED', 'The request has invalid values.', [{ key: 'order_id', label: 'Order ID', reason: 'Required.' }])),
          },
        },
        get: {
          operationId: 'listTickets',
          tags: ['Tickets'],
          summary: 'List the tickets of this Application',
          description: 'Needs `tickets:read`. At most 200 tickets, in Status order.',
          responses: {
            200: {
              description: 'The tickets, and the number for each Status.',
              content: { 'application/json': {
                schema: { type: 'object', required: ['data', 'counts'], properties: { data: { type: 'array', items: ref('TicketSummary') }, counts: { type: 'object', additionalProperties: { type: 'integer' } } } },
                example: { data: [summaryExample], counts: { open: 1 } },
              } },
            },
            401: unauthorized(),
            403: error('The Application is disabled or has no `tickets:read`.'),
          },
        },
      },
      '/api/v1/tickets/{ref}': {
        get: {
          operationId: 'getTicket',
          tags: ['Tickets'],
          summary: 'Get one ticket',
          description: 'Needs `tickets:read`. A ticket of another source answers 404, the same as one that does not exist.',
          parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' }, example: 'PAY-1048', description: 'The Ticket Number, or a Ticket Reference such as PAY-1048.' }],
          responses: {
            200: { description: 'The ticket.', content: json('Ticket', ticketExample) },
            401: unauthorized(),
            403: error('The Application is disabled or has no `tickets:read`.'),
            404: error('No ticket of this Application has this reference.', errorExample('NOT_FOUND', 'No ticket with this reference.')),
          },
        },
      },
      '/api/v1/ticket-types': {
        get: {
          operationId: 'listTicketTypes',
          tags: ['Ticket Types'],
          summary: 'List the Ticket Types this Application may use',
          responses: {
            200: { description: 'The allowed types.', content: { 'application/json': {
              schema: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: ref('TicketType') } } },
              example: { data: [ticketTypeExample] },
            } } },
            401: unauthorized(),
          },
        },
      },
      '/api/v1/ticket-types/{id}': {
        get: {
          operationId: 'getTicketType',
          tags: ['Ticket Types'],
          summary: 'Get a Ticket Type and its Fields',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 3 }],
          responses: {
            200: { description: 'The type and the Fields of its newest Schema Version.', content: json('TicketTypeWithFields', { ...ticketTypeExample, schema_version: 2, fields: fieldsExample }) },
            401: unauthorized(),
            404: error('No allowed Ticket Type has this ID.'),
          },
        },
      },
      '/api/v1/contacts/{id}': {
        delete: {
          operationId: 'eraseContact',
          tags: ['Contacts'],
          summary: 'Erase a Contact',
          description: 'Erasure: the name, email and external ID become `[erased]`; the title, description, Field values, comments and files of the Contact\'s tickets are removed. The tickets stay with their numbers and Statuses. Only for Contacts of this Application. A repeat answers 204 too and finishes an Erasure that failed half way. The Contact id is `requester.id` of its tickets.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 77 }],
          responses: {
            204: { description: 'The Contact is erased.' },
            401: unauthorized(),
            403: error('The Application is disabled.'),
            404: error('No Contact of this Application has this ID.'),
          },
        },
      },
    },
  }
}
