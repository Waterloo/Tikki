import { sql } from 'drizzle-orm'
import { blob, check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
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
  /** Set when an Admin archives the type (4.15f). Archived types take no new tickets; old tickets keep them. */
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
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
  // The Requester is a User or a Contact, never both and never neither (the CHECK below).
  requesterId: text('requester_id').references(() => user.id),
  contactId: integer('contact_id').references(() => contact.id),
  channel: text('channel', { enum: ['web', 'ai', 'api'] }).notNull(),
  // Nullable only because SQLite cannot add a NOT NULL column with a foreign key. Every ticket has a Status.
  status: text('status').references(() => status.key),
  assigneeId: text('assignee_id').references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  // Issue 09: set when a Requester reopened a resolved ticket after the 14 days. Points to the old ticket.
  reopenedFrom: integer('reopened_from').references((): AnySQLiteColumn => ticket.number),
}, t => [
  index('ticket_requester_idx').on(t.requesterId),
  // Issue 10: list filters and the Status-ordered cursor.
  index('ticket_status_updated_idx').on(t.status, t.updatedAt),
  index('ticket_type_idx').on(t.ticketTypeId),
  index('ticket_assignee_idx').on(t.assigneeId),
  index('ticket_contact_idx').on(t.contactId),
  // Plain column names: drizzle-kit qualifies `${t.col}` with the temporary table name of its table rebuild.
  check('ticket_one_requester', sql`(requester_id IS NULL) <> (contact_id IS NULL)`),
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
  // The author is a User or an Application (issue 12), exactly one (the CHECK below).
  authorId: text('author_id').references(() => user.id),
  applicationId: integer('application_id').references(() => application.id),
  channel: text('channel', { enum: ['web', 'ai', 'api'] }).notNull(),
  visibility: text('visibility', { enum: COMMENT_VISIBILITIES }).notNull(),
  /** Personal data. Erasure clears it. */
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('comment_ticket_idx').on(t.ticketNumber, t.createdAt),
  // Plain column names: drizzle-kit qualifies `${t.col}` with the temporary table name of its table rebuild.
  check('comment_one_author', sql`(author_id IS NULL) <> (application_id IS NULL)`),
])

export const AUDIT_ACTIONS = ['ticket_created', 'status_changed', 'priority_changed', 'assignee_changed', 'field_changed', 'comment_added', 'type_changed', 'description_changed', 'ticket_cancelled', 'ticket_reopened', 'attachment_added',
  // Admin changes with no ticket (subject = ticket type, user, invite or team)
  'type_created', 'type_settings_changed', 'schema_version_created', 'type_archived', 'type_restored',
  'role_changed', 'user_invited', 'invite_resent', 'invite_revoked', 'user_deactivated', 'user_reactivated',
  'team_created', 'team_renamed', 'team_removed', 'team_member_added', 'team_member_removed',
] as const

/** What an Admin change without a ticket is about. A ticket entry has `ticketNumber` and no subject. */
export const AUDIT_SUBJECT_TYPES = ['ticket_type', 'user', 'invite', 'team'] as const
export type AuditSubjectType = typeof AUDIT_SUBJECT_TYPES[number]
export type AuditAction = typeof AUDIT_ACTIONS[number]

/**
 * Append-only: the code only inserts. The facts (who, channel, action, ticket, field key) stay forever (9.4).
 * `before` and `after` are JSON text and hold the values. They are the only place that Erasure must clear:
 * it sets both to SQL NULL, and the row stays. A written value is never SQL NULL (no value is the text `null`),
 * so NULL means "erased" or "this action has no values".
 */
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Set for a ticket entry. Null for an Admin change: then `subjectType` and `subjectId` are set (CHECK below). */
  ticketNumber: integer('ticket_number').references(() => ticket.number),
  subjectType: text('subject_type', { enum: AUDIT_SUBJECT_TYPES }),
  /** The id of the type, User, invite or Team. No foreign key: the subject may be deleted and its entry stays. */
  subjectId: text('subject_id'),
  // The Principal is a User or an Application (issue 12), exactly one (the CHECK below).
  principalId: text('principal_id').references(() => user.id),
  applicationId: integer('application_id').references(() => application.id),
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
}, t => [
  index('audit_log_ticket_idx').on(t.ticketNumber, t.id),
  index('audit_log_subject_idx').on(t.subjectType, t.subjectId, t.id),
  // Exactly one subject: a ticket, or a thing without a ticket.
  // Plain column names: drizzle-kit qualifies `${t.col}` with the temporary table name of its table rebuild.
  check('audit_log_one_subject', sql`(ticket_number IS NOT NULL AND subject_type IS NULL AND subject_id IS NULL)
    OR (ticket_number IS NULL AND subject_type IS NOT NULL AND subject_id IS NOT NULL)`),
  check('audit_log_one_principal', sql`(principal_id IS NULL) <> (application_id IS NULL)`),
])

// Issue 16: attachments
/**
 * A file in the private R2 bucket (7.1). The R2 key is the `id`.
 * `ticketNumber` is null for an upload made before its ticket exists; only the uploader can read it until a ticket claims it.
 */
export const attachment = sqliteTable('attachment', {
  id: text('id').primaryKey(),
  ticketNumber: integer('ticket_number').references(() => ticket.number),
  // The uploader is a User or an Application (issue 12), exactly one (the CHECK below).
  uploaderId: text('uploader_id').references(() => user.id),
  applicationId: integer('application_id').references(() => application.id),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('attachment_ticket_idx').on(t.ticketNumber),
  // Plain column names: drizzle-kit qualifies `${t.col}` with the temporary table name of its table rebuild.
  check('attachment_one_uploader', sql`(uploader_id IS NULL) <> (application_id IS NULL)`),
])

// Issue 20: people and teams

/** An Agent (or Admin) in a Team. An Agent can be in several Teams. */
export const teamMember = sqliteTable('team_member', {
  teamId: integer('team_id').notNull().references(() => team.id),
  userId: text('user_id').notNull().references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [primaryKey({ columns: [t.teamId, t.userId] }), index('team_member_user_idx').on(t.userId)])

/**
 * An email outside the allowed domains that an Admin let in (3.16). The row stays after the first sign-in
 * (`acceptedAt`), so the User can sign in again. A pending invite expires at `expiresAt`.
 */
export const invite = sqliteTable('invite', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  invitedBy: text('invited_by').notNull().references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
})

// Issue 08: change prefix
/** A prefix that a type had before. It stays reserved, so an old reference never reads as another type (4.9b). */
export const ticketTypeOldPrefix = sqliteTable('ticket_type_old_prefix', {
  prefix: text('prefix').primaryKey(),
  ticketTypeId: integer('ticket_type_id').notNull().references(() => ticketType.id),
  replacedAt: integer('replaced_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

// Issue 18: Inbox notifications and preferences
export const NOTIFICATION_KINDS = ['ticket_created', 'assigned', 'public_comment', 'internal_comment', 'status_changed', 'webhook_failing', 'webhook_disabled'] as const
export type NotificationKind = typeof NOTIFICATION_KINDS[number]

/** One row for each notice for one User. The Inbox always gets every notice; preferences only control email (8.15). */
export const notification = sqliteTable('notification', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => user.id),
  kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
  ticketNumber: integer('ticket_number').references(() => ticket.number),
  /** The comment, for the two comment kinds. The text is read from `comment`, so Erasure clears it too. */
  commentId: text('comment_id').references(() => comment.id),
  actorId: text('actor_id').references(() => user.id),
  /** JSON. `{ status }` for status_changed; `{ head, body, href }` for the webhook kinds, which have no ticket. */
  data: text('data', { mode: 'json' }).$type<Record<string, string>>(),
  readAt: integer('read_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  // The unread count and the Unread filter.
  index('notification_user_read_idx').on(t.userId, t.readAt),
  index('notification_user_id_idx').on(t.userId, t.id),
])

export const PREFERENCE_KEYS = ['team_ticket', 'assigned', 'public_comment', 'internal_comment', 'status_changed', 'webhook'] as const
export type PreferenceKey = typeof PREFERENCE_KEYS[number]

/** A row only exists after the User changed a default (see server/utils/notifications.ts). */
export const notificationPreference = sqliteTable('notification_preference', {
  userId: text('user_id').notNull().references(() => user.id),
  key: text('key', { enum: PREFERENCE_KEYS }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
}, t => [uniqueIndex('notification_preference_user_key_unique').on(t.userId, t.key)])

// Issue 17: Upload Links
/**
 * A one-time link that lets one User upload one file to one ticket. Only a hash of the token is stored.
 * `usedAt` is set by a conditional UPDATE, which is what makes "works once" hold on D1.
 */
export const uploadLink = sqliteTable('upload_link', {
  tokenHash: text('token_hash').primaryKey(),
  ticketNumber: integer('ticket_number').notNull().references(() => ticket.number),
  userId: text('user_id').notNull().references(() => user.id),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

// Issue 12: Applications, API keys, and Contacts

export const APPLICATION_PERMISSIONS = ['tickets:create', 'tickets:read', 'tickets:update', 'comments:create'] as const
export type ApplicationPermission = typeof APPLICATION_PERMISSIONS[number]

/** Another system that uses the REST API with its own keys. It sees only the tickets it created (3.11). */
export const application = sqliteTable('application', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  // JSON lists, so one row read gives the whole Principal on each API request. The Admin routes check the values.
  permissions: text('permissions', { mode: 'json' }).$type<ApplicationPermission[]>().notNull().default([]),
  ticketTypeIds: text('ticket_type_ids', { mode: 'json' }).$type<number[]>().notNull().default([]),
  // Null while enabled. A disabled Application's keys are refused at once.
  disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

/** Only the SHA-256 of the key is kept. The full key is shown once, when it is created (3.9). */
export const apiKey = sqliteTable('api_key', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  applicationId: integer('application_id').notNull().references(() => application.id),
  name: text('name').notNull(),
  /** Hex SHA-256 of the full key. */
  keyHash: text('key_hash').notNull().unique(),
  /** The first characters of the key, for the Admin list. */
  prefix: text('prefix').notNull(),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  // Revoked keys stay, so the list of who had access is not lost.
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
}, t => [index('api_key_application_idx').on(t.applicationId)])

/** An external person an Application creates tickets for. Unique on (Application, external ID) (3.8). */
export const contact = sqliteTable('contact', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  applicationId: integer('application_id').notNull().references(() => application.id),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [uniqueIndex('contact_application_external_unique').on(t.applicationId, t.externalId)])

/** The first result of a create with an `Idempotency-Key`, for 24 hours (6.3). */
export const idempotencyKey = sqliteTable('idempotency_key', {
  applicationId: integer('application_id').notNull().references(() => application.id),
  key: text('key').notNull(),
  /** Hex SHA-256 of the request body, so the same key with another body is refused. */
  requestHash: text('request_hash').notNull(),
  ticketNumber: integer('ticket_number').notNull().references(() => ticket.number),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [
  // The primary key is the guard against two concurrent creates with one key: the second batch fails as a whole.
  primaryKey({ columns: [t.applicationId, t.key] }),
  index('idempotency_key_created_idx').on(t.applicationId, t.createdAt),
])

// Issue 14: outbox and Webhook Endpoints
export const WEBHOOK_EVENTS = ['ticket.created', 'ticket.updated', 'comment.created'] as const
export type WebhookEventType = typeof WEBHOOK_EVENTS[number]
/** The Event that "Send test event" sends. It goes only to the endpoint that asked for it. */
export const TEST_EVENT = 'webhook.test'

export const webhookEndpoint = sqliteTable('webhook_endpoint', {
  id: text('id').primaryKey(),
  /** `admin`: gets every Event. `application`: only the fixed public events of its own Application's tickets (issue 15). */
  owner: text('owner', { enum: ['admin', 'application'] }).notNull().default('admin'),
  /** Set iff `owner` is `application`. At most one endpoint for each Application. */
  applicationId: integer('application_id').references(() => application.id),
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
}, t => [
  uniqueIndex('webhook_endpoint_application_unique').on(t.applicationId),
  check('webhook_endpoint_owner_application', sql`(owner = 'application') = (application_id IS NOT NULL)`),
])

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
  /** Set for an Application endpoint: the Application's view of the Event. Null: send the Event's own payload. */
  payload: text('payload'),
}, t => [
  uniqueIndex('webhook_delivery_event_endpoint_unique').on(t.eventId, t.endpointId),
  index('webhook_delivery_due_idx').on(t.state, t.nextAttemptAt),
  index('webhook_delivery_endpoint_idx').on(t.endpointId, t.id),
])

// Issue 19: notification email

/** One row (id 1). The last transport error, for Admins in Settings. Cleared when a send works. */
export const mailStatus = sqliteTable('mail_status', {
  id: integer('id').primaryKey(),
  lastError: text('last_error'),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
})

/**
 * A row means the email step ran for that notice (sent, skipped or failed). It is never retried. A separate table, because
 * the notice writers use positional INSERT ... SELECT on `notification`.
 */
export const notificationMail = sqliteTable('notification_mail', {
  notificationId: integer('notification_id').primaryKey().references(() => notification.id, { onDelete: 'cascade' }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
})
