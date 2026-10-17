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
}, t => [
  index('ticket_requester_idx').on(t.requesterId),
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
