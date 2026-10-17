# 06 · Public and Internal Comments, Activity, and Revert

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Agents and Requesters talk on the ticket, and every change is visible and reversible.

- Comments are Public or Internal. Requesters can write only Public Comments and never see Internal ones. An Agent's reply box defaults to Internal and changes color and text in Public mode, as on the design canvas.
- The append-only **audit log** records every action with Principal, channel, and change. It keeps facts, not personal values that Erasure must remove later (store values in a way that Erasure can clear them).
- **Activity** on the ticket is the audit log filtered to that ticket, mixed with the comments in time order.
- Revert on a reversible entry (Status, Priority, assignee, Field value) creates a new change. It never deletes history.

## Acceptance criteria

- [x] REST test: a Requester cannot list or read Internal Comments on their own ticket.
  Evidence: `test/worker/comments.test.ts`, "hides Internal Comments from the Requester in list, read, Activity and count". The list and Activity leave them out, a read answers 404 with the same body as a missing comment, and `comment_count` does not count them. Also "refuses an Internal Comment from a Requester, and a comment on a ticket they cannot read".
- [x] REST test: an Agent comment without a visibility value is Internal.
  Evidence: `test/worker/comments.test.ts`, "makes an Agent comment without a visibility Internal, and a Requester comment Public".
- [x] REST test: each change (Status, Priority, assignee, Field value, comment) adds one audit entry with Principal and channel.
  Evidence: `test/worker/comments.test.ts`, "writes entries for create, Status, Priority, assignee, Field value and comment" (REST, channel `web`, with the before and after values; the comment body is not in the log), "writes no entry for a request that changes nothing or fails", and "records the channel \"ai\" for changes through MCP" (create, Status, Priority, assignee).
- [x] REST test: Revert restores the previous value and adds a new audit entry.
  Evidence: `test/worker/comments.test.ts`, describe "Revert": restores the value and adds an entry with `reverts_id`; reverts Status, assignee and a Field value; refuses an entry whose value changed since (409 `VALUE_CHANGED`), a creation or a comment (409 `NOT_REVERSIBLE`), an entry with erased values, an unknown entry (404), an entry of another ticket (404), and a Requester (403).
- [x] Playwright flow: an Agent sends a public reply, and the Requester sees it. An internal note stays hidden from the Requester.
  Evidence: `e2e/comments.spec.ts`. The Admin (an Agent role) writes an internal note (the default mode) and a public reply, changes Priority and reverts it from the Activity; the Requester sees only the public reply, has no mode switch and no Revert button, and replies; the Agent sees that reply.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)

## Not verified

- Seen in the browser against `wrangler dev` (Admin, light and dark, internal and public mode, 375 px with `scrollWidth` 375). Not seen: the loading skeleton and the Activity error state of the conversation; the Requester view was only checked by the Playwright flow, not by eye.
- Two Agents reverting the same entry at the same moment: the check and the write are separate statements (D1 has no interactive transactions), so both could pass the check. The window is a few milliseconds and the result is two audit entries, not a lost one.
- The CPU time of the Activity route was not measured. It runs 4 queries in parallel and one more for assignee names.

## Decisions made here

1. **Erasure shape of the audit log.** `audit_log` keeps facts in their own columns (`ticket_number`, `principal_id`, `channel`, `action`, `field_key`, `comment_id`, `reverts_id`, time). The values are JSON text in `before` and `after`, and only these two columns hold personal values. Erasure (issue 22) runs `UPDATE audit_log SET before = NULL, after = NULL WHERE ticket_number IN (...)`; the row stays. A written value is never SQL NULL (no value is the text `null`), so NULL means erased. The Activity then shows "changed Status" without values, and the entry is no longer reversible. Comment bodies are not in the log: the entry holds `comment_id`, and Erasure clears `comment.body`. Field values are in the log only through `before` and `after`.
2. **One writer for the log.** `auditEntry(db, principal, input)` in `server/utils/audit.ts` returns a Drizzle insert and does not run it. Callers put it in the `db.batch` of their change. Ticket creation uses `ticketNumber: sql\`last_insert_rowid()\`` in the same batch.
3. **Actions.** `ticket_created`, `status_changed`, `priority_changed`, `assignee_changed`, `field_changed` (one entry for each Field key), `comment_added`. A PATCH that changes several values writes one entry for each value. A request that changes nothing writes nothing. Channel is the Principal's channel (`web`, `ai`, `api`).
4. **Comment visibility rules are in the policy.** New actions `comment` (anyone who can read), `comment_internal` (Agent and Admin) and `edit_fields` (Agent and Admin for now) in `server/utils/policy.ts`, plus `canSeeInternal(principal)` for lists and counts. They appear in `allowed_actions`, so a Requester now has `['comment']`.
5. **Default visibility.** No visibility: Agent or Admin writes Internal, Requester writes Public. A Requester who asks for `internal` gets 403 `FORBIDDEN`, not a silent change to public.
6. **Field value change.** No path changed Field values before, so `PATCH /api/v1/tickets/{ref}` takes `fields: { key: value }` (Agent and Admin only). Only the sent keys change; an empty value clears a Field. Only the sent Fields are validated, so an old value that is no longer valid never blocks another edit. Issue 09 gives the Requester this action with the Status Category rule (4.20).
7. **Revert rules.** Reversible: Status, Priority, assignee, Field value. An entry can be reverted only when it is the latest entry for that key (same action and Field key) and the current value of the ticket still equals its `after`. So an entry that a later change or a later revert replaced is refused with 409 `VALUE_CHANGED`; an entry without values (erased), a creation or a comment is refused with 409 `NOT_REVERSIBLE`. The revert is a new entry with `reverts_id`, made through the same policy action as the original change (`change_status`, `change_priority`, `assign`, `edit_fields`), so a Requester gets 403. Revert of an assignee refuses with 409 if the earlier assignee can no longer be assigned. Reverting a revert works (it is the latest entry). A reverted Field value is not validated again, because it restores old data.
8. **A comment updates `ticket.updated_at`.** So the queue order and "Updated" show new conversation.
9. **A Requester sees Activity** (events and Public Comments) but no Internal Comments, and no Revert button. Events keep the Principal's name, so the Requester sees who changed the Status.
10. **IDs.** Comments have a UUID primary key made in code, so the comment and its audit entry fit in one batch. Audit entries have an integer ID (the Revert endpoint takes it).
11. **Not done on purpose:** MCP comment tools (issue 11), an "Attach file" button (issue 16), a "Contact" badge on comments (issue 13).

## Glossary terms to add

- **Audit log**: the append-only table of every change, with Principal, channel, and values. Activity is the audit log of one ticket mixed with its comments. Only Erasure clears its values.
- **Revert**: a new change that sets a value back to what an earlier Activity entry changed it from. It never deletes history.

## Notes for later issues

- **Entries without a ticket:** `audit_log.ticket_number` is nullable. A row has either a ticket, or `subject_type` (`ticket_type`, `user`, `invite`, `team`) and `subject_id`; a CHECK enforces exactly one. Use `adminAuditEntry(db, principal, { subject, action, values })` for those. `listActivity` filters by ticket number, so it shows only ticket entries.
- **Write the log with `auditEntry`** (`server/utils/audit.ts`). It returns an insert. Put it in the same `db.batch([...])` as the change:
  `await db.batch([db.update(...), auditEntry(db, principal, { ticketNumber, action, fieldKey?, values: { before, after } })])`.
  To add an action, add it to `AUDIT_ACTIONS` in the schema (a TypeScript enum, no migration needed), and to `REVERSIBLE` in `server/utils/activity.ts` if it can be reverted. Put values only in `values`, never in other columns, so Erasure can clear them. Issues 07 (type and Field edits), 12 (Application as Principal: add an `application_id` column, `principal_id` is a User today), 16 and 20 should call it.
- **Ticket changes go through `applyChange`** (`server/utils/tickets.ts`): the ticket update and its entries in one batch. Issue 08 (type change) should use it too.
- **Issue 22 (Erasure):** clear `audit_log.before/after` for the ticket and `comment.body`, and keep the rows. `revertEntry` and `listActivity` already handle NULL values.
- **Issue 11:** MCP comment tools call `createComment(db, principal, number, { body, visibility })` from `server/utils/activity.ts`. Its results carry the body of a comment, so mark it as untrusted content (5.7). `listComments` already filters Internal Comments by Principal. Issue 14 and 15 webhooks: `comment.created` for an Application only for `visibility = 'public'`.
- **Issue 09:** extend `authorize` for `edit_fields` with the Status Category rule.
- REST: `GET/POST /api/v1/tickets/{ref}/comments`, `GET /api/v1/tickets/{ref}/comments/{id}`, `GET /api/v1/tickets/{ref}/activity`, `POST /api/v1/tickets/{ref}/activity/{id}/revert` (returns the ticket). `TicketDetail` has `comment_count`.
- `app/components/TicketConversation.vue` holds the reply box and the timeline. The ticket page bumps `version` after each save, so the timeline reloads.
