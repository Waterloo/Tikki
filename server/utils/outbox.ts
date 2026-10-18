import { eq, sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { outboxEvent, webhookDelivery, type CommentVisibility, type WebhookEventType } from '../db/schema'
import type { Db } from './auth'
import type { ChangeEntry, Principal } from './tickets'

export interface EventInput {
  type: WebhookEventType
  /** A number, or SQL for a ticket that an earlier statement of the same batch inserted. */
  ticketNumber: number | SQL
  /** For `ticket.updated`: from `changedKey`. */
  changed?: string[]
  /** For `comment.created`. The row must be written by the change statements. */
  comment?: { id: string, visibility: CommentVisibility }
}

/**
 * The one rule for internal data (8.5). An Event is internal when it carries an Internal Comment. Fields have no
 * visibility of their own (3.6), and the ticket view in `before` and `after` holds no comments, so no other part of
 * a payload is internal. Only endpoints with "include internal data" get an internal Event.
 */
export function isInternal(event: EventInput): boolean {
  return event.comment?.visibility === 'internal'
}

/** The key in `changed` for one audit entry: the ticket view's key for core values, the Field Key for a Field. */
export function changedKey(entry: Pick<ChangeEntry, 'action' | 'fieldKey'>): string {
  switch (entry.action) {
    case 'status_changed': return 'status'
    case 'priority_changed': return 'priority'
    case 'assignee_changed': return 'assignee'
    case 'field_changed': return entry.fieldKey!
    case 'type_changed': return 'ticket_type'
    case 'description_changed': return 'description'
    // Cancel and reopen change the Status.
    case 'ticket_cancelled':
    case 'ticket_reopened': return 'status'
  }
}

/** Milliseconds to the format of `Date.toISOString()`, with integer math, so no float rounding changes the value. */
const iso = (ms: SQL) => sql`strftime('%Y-%m-%dT%H:%M:%S', ${ms} / 1000, 'unixepoch') || '.' || printf('%03d', ${ms} % 1000) || 'Z'`

/**
 * The full ticket view as JSON, built by D1 inside the batch. So `before` and `after` are exact snapshots, and the
 * Worker spends no CPU on them (2.6). Subquery results lose their JSON type, so `json()` wraps them.
 */
function ticketJson(number: number | SQL): SQL {
  return sql`json((SELECT json_object(
    'number', t.number,
    'ref', tt.prefix || '-' || t.number,
    'title', t.title,
    'description', t.description,
    'priority', t.priority,
    'status', json_object('key', s.key, 'name', s.name, 'category', s.category),
    'ticket_type', json_object('id', tt.id, 'name', tt.name, 'prefix', tt.prefix),
    'team', json((SELECT json_object('id', tm.id, 'name', tm.name) FROM team tm WHERE tm.id = tt.team_id)),
    -- A Contact (issue 12) has no User row; its ticket names the Contact and its Application.
    'requester', CASE WHEN t.contact_id IS NULL
      THEN json_object('kind', 'user', 'id', r.id, 'name', r.name, 'email', r.email)
      ELSE json((SELECT json_object('kind', 'contact', 'id', c.id, 'external_id', c.external_id, 'name', c.name, 'email', c.email, 'application_id', c.application_id) FROM contact c WHERE c.id = t.contact_id))
    END,
    'assignee', json((SELECT json_object('id', a.id, 'name', a.name, 'email', a.email) FROM user a WHERE a.id = t.assignee_id)),
    'schema_version', t.schema_version,
    'fields', json(t.fields),
    'channel', t.channel,
    'created_at', ${iso(sql`t.created_at`)},
    'updated_at', ${iso(sql`t.updated_at`)})
  FROM ticket t
  JOIN ticket_type tt ON tt.id = t.ticket_type_id
  LEFT JOIN user r ON r.id = t.requester_id
  LEFT JOIN status s ON s.key = t.status
  WHERE t.number = ${number}))`
}

function actorJson(principal: Principal): SQL {
  if (principal.kind === 'application') {
    return sql`json((SELECT json_object('kind', 'application', 'id', a.id, 'name', a.name, 'channel', ${principal.channel}) FROM application a WHERE a.id = ${principal.applicationId}))`
  }
  return sql`json((SELECT json_object('kind', 'user', 'id', u.id, 'name', u.name, 'channel', ${principal.channel}) FROM user u WHERE u.id = ${principal.userId}))`
}

function commentJson(id: string): SQL {
  return sql`json((SELECT json_object(
    'id', c.id, 'visibility', c.visibility, 'body', c.body, 'channel', c.channel,
    'author', CASE WHEN c.author_id IS NOT NULL THEN json_object('kind', 'user', 'id', u.id, 'name', u.name)
      ELSE json_object('kind', 'application', 'id', ap.id, 'name', ap.name) END,
    'created_at', ${iso(sql`c.created_at`)})
  FROM comment c LEFT JOIN user u ON u.id = c.author_id LEFT JOIN application ap ON ap.id = c.application_id WHERE c.id = ${id}))`
}

/**
 * One delivery for each endpoint that is on, wants this type, and may get this Event. An insert-select with SQL
 * names every column of the table in order; a new column fails here loudly until it is added.
 */
function fanOut(db: Db, id: string, type: string, internal: boolean, now: Date) {
  return db.insert(webhookDelivery).select(sql`SELECT NULL, ${id}, e.id, 'pending', 0, ${now.getTime()}, NULL, NULL, NULL, ${now.getTime()}
    FROM webhook_endpoint e
    WHERE e.enabled = 1 AND (e.include_internal = 1 OR ${internal ? 1 : 0} = 0)
      AND EXISTS (SELECT 1 FROM json_each(e.events) WHERE value = ${type})`)
}

type Batch = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]

/**
 * Wraps the statements of a ticket change with its outbox Event, for one `db.batch`: the change, its audit entries,
 * the Event, and its deliveries are written together or not at all (8.4). `before` is read before the change and
 * `after` after it. The statements of `change` keep their order and come first for `ticket.created`, so the caller
 * can read the result of its insert at index 0.
 */
export function withEvent(db: Db, principal: Principal, event: EventInput, change: Batch): Batch {
  const id = crypto.randomUUID()
  const now = new Date()
  const internal = isInternal(event)
  const head = sql`'event_id', ${id}, 'type', ${event.type}, 'created_at', ${now.toISOString()},
    'changed', json(${JSON.stringify(event.changed ?? [])}), 'actor', ${actorJson(principal)}`
  const insert = (payload: SQL) => db.insert(outboxEvent).values({ id, type: event.type, ticketNumber: event.ticketNumber, internal, payload, createdAt: now })
  const deliveries = fanOut(db, id, event.type, internal, now)

  if (event.type === 'ticket.created') {
    return [...change, insert(sql`json_object(${head}, 'before', NULL, 'after', ${ticketJson(event.ticketNumber)})`), deliveries]
  }
  const comment = event.comment ? sql`, '$.comment', ${commentJson(event.comment.id)}` : sql``
  return [
    insert(sql`json_object(${head}, 'before', ${ticketJson(event.ticketNumber)}, 'after', NULL)`),
    ...change,
    db.update(outboxEvent).set({ payload: sql`json_set(payload, '$.after', ${ticketJson(event.ticketNumber)}${comment})` }).where(eq(outboxEvent.id, id)),
    deliveries,
  ]
}
