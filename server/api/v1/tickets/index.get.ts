import { z } from 'zod'
import { PRIORITIES } from '../../../db/schema'
import { apiError, restPrincipal, ticketError, validationFailed } from '../../../utils/rest'
import { db } from '../../../utils/services'
import { FIELD_KEY, listTickets, MAX_LIMIT, MAX_SEARCH_LENGTH, type ListFilter } from '../../../utils/tickets'

const FIELD_FILTER = /^([\w-]{1,64}):(.{1,200})$/

const empty = (v: unknown) => (v === '' ? undefined : v)
const query = z.object({
  requester: z.literal('me', { error: 'Must be me.' }).optional(),
  assignee: z.string().min(1, 'Must be me, none, or a User ID.').max(100).optional(),
  q: z.string().max(MAX_SEARCH_LENGTH, `Must be ${MAX_SEARCH_LENGTH} characters or fewer.`).optional(),
  type: z.preprocess(empty, z.coerce.number({ error: 'Must be a Ticket Type ID.' }).int().positive('Must be a Ticket Type ID.')).optional(),
  priority: z.enum(PRIORITIES, { error: 'Must be one of the options.' }).optional(),
  // `field=branch:Singapore`, repeated for more Fields.
  field: z.union([z.string(), z.array(z.string())]).transform(v => [v].flat()).optional(),
  open: z.literal('true', { error: 'Must be true.' }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.preprocess(empty, z.coerce.number({ error: 'Must be a number.' }).int().min(1, 'Must be at least 1.').max(MAX_LIMIT, `Must be ${MAX_LIMIT} or fewer.`)).optional(),
})

/**
 * Filters: `requester=me`, `assignee=me|none|<User ID>`, `q` (words, or a Ticket Reference), `type`, `priority`,
 * `field=<key>:<value>` (any Schema Version), `open=true`. Paging: `limit`, `cursor` (the `next_cursor` of the last page).
 */
export default defineEventHandler(async (event) => {
  const principal = await restPrincipal(event)
  if (principal instanceof Response) return principal
  const parsed = query.safeParse(getQuery(event))
  if (!parsed.success) return validationFailed(parsed.error.issues)
  const { field = [], ...q } = parsed.data

  const fields: NonNullable<ListFilter['fields']> = []
  for (const f of field) {
    const match = FIELD_FILTER.exec(f)
    if (!match || !FIELD_KEY.test(match[1]!)) {
      return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', [
        { key: 'field', label: 'Field', reason: 'Must look like key:value, for example branch:Singapore.' },
      ])
    }
    fields.push({ key: match[1]!, value: match[2]! })
  }

  try {
    const { tickets, counts, nextCursor } = await listTickets(db, principal, {
      requesterIsMe: q.requester === 'me',
      assignee: q.assignee,
      search: q.q,
      ticketTypeId: q.type,
      priority: q.priority,
      fields,
      openOnly: q.open === 'true',
    }, { cursor: q.cursor, limit: q.limit })
    return { data: tickets, counts, next_cursor: nextCursor }
  } catch (error) {
    return ticketError(error)
  }
})
