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
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [index('ticket_requester_idx').on(t.requesterId)])

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
