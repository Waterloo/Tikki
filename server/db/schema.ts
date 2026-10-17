import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { FieldDef, FieldValues } from '../utils/fields'
import { user } from './auth-schema'

export * from './auth-schema'

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type Priority = typeof PRIORITIES[number]

export const team = sqliteTable('team', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const ticketType = sqliteTable('ticket_type', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  // Unique across all types, archived ones too, so an old reference never reads as another type (4.9b).
  prefix: text('prefix').notNull().unique(),
  description: text('description').notNull(),
  /** An Iconify name, for example `i-lucide-bug`. */
  icon: text('icon').notNull().default('i-lucide-ticket'),
  /** A `#rrggbb` color. */
  color: text('color').notNull().default('#4B5563'),
  // Nullable only because SQLite cannot add a NOT NULL column with a foreign key. Every type has a Team (4.13).
  teamId: integer('team_id').references(() => team.id),
  visibleToAll: integer('visible_to_all', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

/** An immutable snapshot of the Fields of a Ticket Type (4.4). A change to the Fields adds a row; no row is updated. */
export const schemaVersion = sqliteTable('schema_version', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketTypeId: integer('ticket_type_id').notNull().references(() => ticketType.id),
  version: integer('version').notNull(),
  fields: text('fields', { mode: 'json' }).$type<FieldDef[]>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [uniqueIndex('schema_version_type_version_unique').on(t.ticketTypeId, t.version)])

/** Filters and Events use the category, so later Workflows can add Statuses inside these four (4.10). */
export const STATUS_CATEGORIES = ['open', 'active', 'waiting', 'done'] as const
export type StatusCategory = typeof STATUS_CATEGORIES[number]

/** Seeded by migration 0002. v1 has no way to edit these rows (4.10). */
export const status = sqliteTable('status', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  category: text('category', { enum: STATUS_CATEGORIES }).notNull(),
  position: integer('position').notNull(),
})

export const ticket = sqliteTable('ticket', {
  // AUTOINCREMENT is the global counter: SQLite never reuses a number, even after a delete (4.9).
  number: integer('number').primaryKey({ autoIncrement: true }),
  ticketTypeId: integer('ticket_type_id').notNull().references(() => ticketType.id),
  /** The `version` of the Schema Version of this type that the ticket is pinned to (4.4). */
  schemaVersion: integer('schema_version').notNull().default(1),
  title: text('title').notNull(),
  description: text('description').notNull(),
  priority: text('priority', { enum: PRIORITIES }).notNull().default('normal'),
  /** Field values keyed by Field Key. */
  fields: text('fields', { mode: 'json' }).$type<FieldValues>().notNull().default({}),
  requesterId: text('requester_id').notNull().references(() => user.id),
  channel: text('channel', { enum: ['web', 'ai', 'api'] }).notNull(),
  // Nullable only because SQLite cannot add a NOT NULL column with a foreign key. Every ticket has a Status.
  status: text('status').references(() => status.key),
  assigneeId: text('assignee_id').references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('ticket_requester_idx').on(t.requesterId),
  // Issue 10: list filters and the Status-ordered cursor.
  index('ticket_status_updated_idx').on(t.status, t.updatedAt),
  index('ticket_type_idx').on(t.ticketTypeId),
  index('ticket_assignee_idx').on(t.assigneeId),
])

/** The one row of organization settings. `id` is always 1 (the migration inserts it). */
export const organization = sqliteTable('organization', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  subtitle: text('subtitle').notNull().default(''),
  // PNG bytes. Read and written with raw D1 statements, so no other query loads them. Null: the UI shows the first letter.
  logo: blob('logo'),
  // Changes with the logo. It is part of the logo URL, so a new logo is not served from a cache.
  logoVersion: integer('logo_version').notNull().default(0),
})

/** One row for each sign-in code request, for the limit of 5 codes an hour for each address. */
export const otpRequest = sqliteTable('otp_request', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [index('otp_request_email_created_idx').on(t.email, t.createdAt)])

// Issue 06: comments and the audit log
export const COMMENT_VISIBILITIES = ['public', 'internal'] as const
export type CommentVisibility = typeof COMMENT_VISIBILITIES[number]

export const comment = sqliteTable('comment', {
  // A UUID made by the code, so the comment and its audit entry go into one db.batch.
  id: text('id').primaryKey(),
  ticketNumber: integer('ticket_number').notNull().references(() => ticket.number),
  authorId: text('author_id').notNull().references(() => user.id),
  channel: text('channel', { enum: ['web', 'ai', 'api'] }).notNull(),
  visibility: text('visibility', { enum: COMMENT_VISIBILITIES }).notNull(),
  /** Personal data. Erasure clears it. */
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [index('comment_ticket_idx').on(t.ticketNumber, t.createdAt)])

export const AUDIT_ACTIONS = ['ticket_created', 'status_changed', 'priority_changed', 'assignee_changed', 'field_changed', 'comment_added'] as const
export type AuditAction = typeof AUDIT_ACTIONS[number]

/**
 * Append-only: the code only inserts. The facts (who, channel, action, ticket, field key) stay forever (9.4).
 * `before` and `after` are JSON text and hold the values. They are the only place that Erasure must clear:
 * it sets both to SQL NULL, and the row stays. A written value is never SQL NULL (no value is the text `null`),
 * so NULL means "erased" or "this action has no values".
 */
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketNumber: integer('ticket_number').notNull().references(() => ticket.number),
  principalId: text('principal_id').notNull().references(() => user.id),
  channel: text('channel', { enum: ['web', 'ai', 'api'] }).notNull(),
  action: text('action', { enum: AUDIT_ACTIONS }).notNull(),
  /** The Field Key, for `field_changed`. */
  fieldKey: text('field_key'),
  /** The comment, for `comment_added`. The body stays in `comment`. */
  commentId: text('comment_id').references(() => comment.id),
  /** The entry that this one reverts. */
  revertsId: integer('reverts_id'),
  before: text('before'),
  after: text('after'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [index('audit_log_ticket_idx').on(t.ticketNumber, t.id)])

// Issue 14: outbox and Webhook Endpoints
export const WEBHOOK_EVENTS = ['ticket.created', 'ticket.updated', 'comment.created'] as const
export type WebhookEventType = typeof WEBHOOK_EVENTS[number]
/** The Event that "Send test event" sends. It goes only to the endpoint that asked for it. */
export const TEST_EVENT = 'webhook.test'

export const webhookEndpoint = sqliteTable('webhook_endpoint', {
  id: text('id').primaryKey(),
  /** `admin`: gets every Event. Issue 15 adds `application` and an `application_id` column. */
  owner: text('owner', { enum: ['admin'] }).notNull().default('admin'),
  name: text('name').notNull(),
  url: text('url').notNull(),
  events: text('events', { mode: 'json' }).$type<WebhookEventType[]>().notNull(),
  includeInternal: integer('include_internal', { mode: 'boolean' }).notNull().default(false),
  /** The signing secret, encrypted with a key from BETTER_AUTH_SECRET. Not a hash: the Worker must sign with it. */
  secret: text('secret').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** The first failed attempt since the last success. Null while healthy. */
  failingSince: integer('failing_since', { mode: 'timestamp_ms' }),
  /** Failed attempts since the last success. */
  failures: integer('failures').notNull().default(0),
  /** Set when the delivery run turned the endpoint off after 3 days of failure. */
  disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

/** One Event. Written in the same batch as the ticket change. `id` is the `event_id` and never changes on retry. */
export const outboxEvent = sqliteTable('outbox_event', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  /** Null for a test event. */
  ticketNumber: integer('ticket_number'),
  /** Only endpoints with "include internal data" get it. */
  internal: integer('internal', { mode: 'boolean' }).notNull(),
  /** The JSON body that is sent and signed, the same bytes on every attempt. Purged after 30 days (9.3). */
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [index('outbox_event_created_idx').on(t.createdAt)])

export const DELIVERY_STATES = ['pending', 'delivered', 'failed'] as const
export type DeliveryState = typeof DELIVERY_STATES[number]

/** One Event for one endpoint. Made in the batch of the Event, for each endpoint that is on at that time. */
export const webhookDelivery = sqliteTable('webhook_delivery', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: text('event_id').notNull().references(() => outboxEvent.id),
  endpointId: text('endpoint_id').notNull().references(() => webhookEndpoint.id),
  state: text('state', { enum: DELIVERY_STATES }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  /** Null when the delivery is not pending. */
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
  lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp_ms' }),
  /** The HTTP status of the last attempt. Null: no response (network error or timeout). */
  responseStatus: integer('response_status'),
  error: text('error'),
  /** The time of the Event. Retries stop 24 hours after it. */
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [
  uniqueIndex('webhook_delivery_event_endpoint_unique').on(t.eventId, t.endpointId),
  index('webhook_delivery_due_idx').on(t.state, t.nextAttemptAt),
  index('webhook_delivery_endpoint_idx').on(t.endpointId, t.id),
])
