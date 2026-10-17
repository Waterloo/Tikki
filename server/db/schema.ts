import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

export * from './auth-schema'

export const ticketType = sqliteTable('ticket_type', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  // Unique across all types, archived ones too, so an old reference never reads as another type (4.9b).
  prefix: text('prefix').notNull().unique(),
  description: text('description').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const ticket = sqliteTable('ticket', {
  // AUTOINCREMENT is the global counter: SQLite never reuses a number, even after a delete (4.9).
  number: integer('number').primaryKey({ autoIncrement: true }),
  ticketTypeId: integer('ticket_type_id').notNull().references(() => ticketType.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  requesterId: text('requester_id').notNull().references(() => user.id),
  channel: text('channel', { enum: ['web', 'ai', 'api'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [index('ticket_requester_idx').on(t.requesterId)])

/** One row for each sign-in code request, for the limit of 5 codes an hour for each address. */
export const otpRequest = sqliteTable('otp_request', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, t => [index('otp_request_email_created_idx').on(t.email, t.createdAt)])
