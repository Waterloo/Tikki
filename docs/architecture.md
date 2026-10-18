# Architecture: the choke points

Read this before you change code in `server/`. Each section is a choke point: one function that owns one rule. Call it. A second copy of the rule drifts, and the drift passes tests until two features merge.

Terms are in [CONTEXT.md](../CONTEXT.md). Decision numbers (`8.4`) are rows in [DECISIONS.md](DECISIONS.md).

## Stack

Nuxt 4 on one Cloudflare Worker. D1 (SQLite), R2 (files), Cron Trigger. Free plan: 5 ms CPU for each route (2.6), so no N+1 queries and no heavy parsing. D1 has no interactive transactions: statements that must succeed together go in one `db.batch([...])`.

## Principal

[`server/utils/tickets.ts`](../server/utils/tickets.ts) `Principal = UserPrincipal | ApplicationPrincipal`.

- Only `UserPrincipal` has `userId` and `role`. Only `ApplicationPrincipal` has `applicationId`, `permissions`, `ticketTypeIds`.
- A ticket of an Application has a Contact as Requester, not a User. `requesterId` is null.
- Narrow with `principal.kind` before you read `userId`. Use `actorId(principal)` for "the User id or null".
- Get a Principal from `restPrincipal(event)` (API key, else session) or `sessionPrincipal(event)` (User only), both in [`rest.ts`](../server/utils/rest.ts). MCP builds a `UserPrincipal` with `channel: 'ai'` in [`mcp.ts`](../server/utils/mcp.ts). `adminPrincipal` and `peoplePrincipal` add the Admin check.
- Why: a bad API key must never fall back to a cookie, and an Application must never reach a User-only route.

## Read rule

[`server/utils/policy.ts`](../server/utils/policy.ts) is the only place for permission rules.

- One ticket: `authorize` / `assertAllowed`, or `loadFor(db, principal, action, number)` in `tickets.ts`. They build on the private `canRead`.
- Many tickets: `readableTickets(principal)` returns the same rule as a SQL condition. Every list and search query uses it. It must give the same answer as `canRead`; the REST tests check both.
- Facts for the rule: `policyFacts(row)` in `tickets.ts` builds `PolicyTicket`. When `PolicyTicket` gets a field, `policyFacts` and its `Pick<DetailRow, ...>` must carry it. Build a `PolicyTicket` nowhere else.
- An unreadable ticket answers `NOT_FOUND`, the same as a missing one. A forbidden action on a readable ticket answers `FORBIDDEN` (3.11, 3.32).
- The UI shows only `allowedActions(...)`.
- Why: a second read rule leaks Restricted, deleted, or Contact tickets through one channel.

## Ticket writes

`applyChange(db, principal, number, set, entries, extra?)` in `tickets.ts`. Every change to an existing ticket goes through it. It writes in one D1 batch:

1. the ticket update,
2. one audit entry for each value (`entries`),
3. the outbox Event `ticket.updated` (`withEvent`),
4. the notices (`noticesForChange`),
5. your `extra` statements (for example a comment insert).

After the batch it calls `queueNoticeMail`. New tickets and comments use the same pieces: `withEvent` + `auditEntry` + a notice writer from `notifications.ts`, in one batch (8.4).

Why: a change without its audit entry, Event, or notice is invisible to Activity, webhooks, or the Inbox.

## Audit log

[`server/utils/audit.ts`](../server/utils/audit.ts). Append-only (9.4).

- `auditEntry(db, principal, input)` for a ticket. `adminAuditEntry(...)` for an Admin change without a ticket (Ticket Type, User, Team). Both return a statement for the batch. Neither runs it.
- Facts go in their own columns. Personal values go only in `before` and `after` (9.5). Erasure clears exactly those two columns.
- Why: a value in any other column survives Erasure.

## Events and the outbox

[`server/utils/outbox.ts`](../server/utils/outbox.ts). `withEvent(db, principal, event, changeStatements)` wraps a change. D1 builds the `before` and `after` ticket JSON inside the batch.

- `fanOut` makes one delivery per endpoint and is the only access rule for Events: Admin endpoints, internal data (8.5), Restricted tickets (8.31).
- `applicationView` (same file) rewrites a payload for Application endpoints: staff become `support`, no assignee, no Team.
- A new payload field must pass both views. A field that is staff data needs a removal in `applicationView`.
- Delivery and retries: [`webhooks.ts`](../server/utils/webhooks.ts) `runOutbox`.

## Views for an Application

Anything that reaches an Application shows staff as `support`: no name, no email, no assignee, no Team, no Internal Comments (3.11).

| Output | View function |
|---|---|
| REST ticket | `forViewer` in `tickets.ts` |
| REST Activity and comments | `toActor` in [`activity.ts`](../server/utils/activity.ts); `canReadInternalComments` in `policy.ts` |
| Webhook payload | `applicationView` in `outbox.ts` |

A new output for an Application gets its view function in the same change.

## Notices and mail

[`server/utils/notifications.ts`](../server/utils/notifications.ts): each writer (`noticeTicketCreated`, `noticesForChange`, `noticeComment`) returns statements for the change batch. Recipients are chosen in SQL. The actor gets no notice for their own change.

[`notice-mail.ts`](../server/utils/notice-mail.ts): `queueNoticeMail({ ticket })` runs after the batch succeeded. It sends in `waitUntil`, so a slow mail transport never delays or rolls back the change. Each notice is claimed once in `notification_mail`.

## Text for the AI

[`untrusted.ts`](../server/utils/untrusted.ts): every user-written string in an MCP result goes through `untrusted()` (`untrustedDeep()` for Field values) (5.7). Why: the wrapper breaks a closing tag, so text cannot leave the marker.

## Attachments

[`attachments.ts`](../server/utils/attachments.ts): `putObject` is the one writer of files: R2 first, then the row and its audit entry. Check rights first with `assertCanAttach` / `authorizeAttach`. A file is as visible as its ticket (7.1).

## Worker entry and Cron

- [`server/entry.ts`](../server/entry.ts) is a custom Worker entry. It puts `handleUpload` ([`upload.ts`](../server/utils/upload.ts)) before Nitro so file bodies stream without a buffer. It spreads the Nitro entry, so `scheduled` is passed on. Keep that spread. Without `scheduled` the Cron never runs, and nothing fails visibly.
- [`server/plugins/outbox.ts`](../server/plugins/outbox.ts) is the Cron run, in this order: `runOutbox` (deliver, retry, disable failing endpoints, purge Events after 30 days, 9.3), `deleteOldCounters` (rate limits), `cleanupUploads` (unattached uploads and used or expired Upload Links older than 24 hours, 7.9).

## Soft delete and Erasure

[`server/utils/privacy.ts`](../server/utils/privacy.ts). `deleteTicket` sets `deletedAt`; the read rule hides the ticket. `eraseContact` removes personal data in one batch, then deletes R2 objects (9.9, 9.10).

- Every table or column that can hold a Contact's personal data needs a statement in `eraseContact`.
- The scan test in [`test/worker/privacy.test.ts`](../test/worker/privacy.test.ts) (`databaseHits`) reads every column of every table and fails on a leftover. Do not weaken it.
