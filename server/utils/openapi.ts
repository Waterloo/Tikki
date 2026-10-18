import { z } from 'zod'
import { FIELD_TYPES, type FieldError } from './fields'
import { PRIORITIES, STATUS_CATEGORIES } from '../db/schema'
import { TICKET_ACTIONS } from './policy'
import type { TicketTypeView, TicketTypeWithFields } from './ticket-types'
import { applicationTicketInput, type TicketDetail, type TicketSummary } from './tickets'

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
  assignee: person.nullable(),
  channel: z.enum(['web', 'ai', 'api']),
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
  team: z.object({ id: z.number().int(), name: z.string() }),
  comment_count: z.number().int().describe('The comments the caller can see. An Application never sees Internal Comments.'),
  reopened_from: z.object({ number: z.number().int(), ref: z.string() }).nullable(),
  allowed_actions: z.array(z.enum(TICKET_ACTIONS)),
})

const ticketTypeOut = z.object({
  id: z.number().int().describe('Send this as `ticket_type_id`.'),
  name: z.string(),
  description: z.string().describe('When to use this type.'),
  icon: z.string(),
  color: z.string(),
  prefix: z.string(),
  team: z.object({ id: z.number().int(), name: z.string() }),
  visible_to_all: z.boolean(),
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

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const json = (name: string) => ({ 'application/json': { schema: ref(name) } })
const error = (description: string) => ({ description, content: json('Error') })

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
          summary: 'Create a ticket for a Contact',
          description: 'Needs `tickets:create`, and the Ticket Type must be in the allowed list. `fields` are checked against the Fields of the type (GET /api/v1/ticket-types/{id}). The Contact is found by `external_id` and gets the name and email sent.',
          parameters: [{
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string', minLength: 1, maxLength: 255 },
            description: 'A repeat with the same key in 24 hours returns the first ticket, with the header `Idempotent-Replayed: true`, and creates nothing. The same key with another body answers 409.',
          }],
          requestBody: { required: true, content: json('TicketCreate') },
          responses: {
            201: { description: 'The ticket.', content: json('Ticket') },
            400: error('The body is not JSON, or the Idempotency-Key is not valid.'),
            401: error('The API key is missing, unknown, or revoked.'),
            403: error('The Application is disabled, has no `tickets:create`, or may not use this Ticket Type.'),
            409: error('The Idempotency-Key was used with another body.'),
            422: error('The body has invalid values. `details` lists each problem.'),
          },
        },
        get: {
          operationId: 'listTickets',
          summary: 'List the tickets of this Application',
          description: 'Needs `tickets:read`. At most 200 tickets, in Status order.',
          responses: {
            200: {
              description: 'The tickets, and the number for each Status.',
              content: { 'application/json': { schema: { type: 'object', required: ['data', 'counts'], properties: { data: { type: 'array', items: ref('TicketSummary') }, counts: { type: 'object', additionalProperties: { type: 'integer' } } } } } },
            },
            401: error('The API key is missing, unknown, or revoked.'),
            403: error('The Application is disabled or has no `tickets:read`.'),
          },
        },
      },
      '/api/v1/tickets/{ref}': {
        get: {
          operationId: 'getTicket',
          summary: 'Get one ticket',
          description: 'Needs `tickets:read`. A ticket of another source answers 404, the same as one that does not exist.',
          parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'The Ticket Number, or a Ticket Reference such as PAY-1048.' }],
          responses: {
            200: { description: 'The ticket.', content: json('Ticket') },
            401: error('The API key is missing, unknown, or revoked.'),
            403: error('The Application is disabled or has no `tickets:read`.'),
            404: error('No ticket of this Application has this reference.'),
          },
        },
      },
      '/api/v1/ticket-types': {
        get: {
          operationId: 'listTicketTypes',
          summary: 'List the Ticket Types this Application may use',
          responses: {
            200: { description: 'The allowed types.', content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: ref('TicketType') } } } } } },
            401: error('The API key is missing, unknown, or revoked.'),
          },
        },
      },
      '/api/v1/ticket-types/{id}': {
        get: {
          operationId: 'getTicketType',
          summary: 'Get a Ticket Type and its Fields',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'The type and the Fields of its newest Schema Version.', content: json('TicketTypeWithFields') },
            401: error('The API key is missing, unknown, or revoked.'),
            404: error('No allowed Ticket Type has this ID.'),
          },
        },
      },
    },
  }
}
