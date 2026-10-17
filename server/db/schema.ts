import { sql } from 'drizzle-orm'
import { blob, check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
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

export const AUDIT_ACTIONS = ['ticket_created', 'status_changed', 'priority_changed', 'assignee_changed', 'field_changed', 'comment_added',
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
}, t => [
  index('audit_log_ticket_idx').on(t.ticketNumber, t.id),
  index('audit_log_subject_idx').on(t.subjectType, t.subjectId, t.id),
  // Exactly one subject: a ticket, or a thing without a ticket.
  check('audit_log_one_subject', sql`(${t.ticketNumber} IS NOT NULL AND ${t.subjectType} IS NULL AND ${t.subjectId} IS NULL)
    OR (${t.ticketNumber} IS NULL AND ${t.subjectType} IS NOT NULL AND ${t.subjectId} IS NOT NULL)`),
])

// Issue 16: attachments
/**
 * A file in the private R2 bucket (7.1). The R2 key is the `id`.
 * `ticketNumber` is null for an upload made before its ticket exists; only the uploader can read it until a ticket claims it.
 */
export const attachment = sqliteTable('attachment', {
  id: text('id').primaryKey(),
  ticketNumber: integer('ticket_number').references(() => ticket.number),
  uploaderId: text('uploader_id').notNull().references(() => user.id),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [index('attachment_ticket_idx').on(t.ticketNumber)])

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
