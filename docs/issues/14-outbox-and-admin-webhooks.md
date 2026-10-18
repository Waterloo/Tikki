# 14 · Outbox and admin Webhook Endpoints

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Every ticket change reaches team tools such as Slack or n8n reliably.

- Each change writes its Event to the outbox in the same D1 `batch()` as the change and its audit entry.
- Events: `ticket.created`, `ticket.updated` (with `changed` Field Keys), `comment.created`. Payload: `event_id`, `type`, `changed`, `actor`, and the full ticket `before` and `after`, each with `number` and `ref`.
- A scheduled handler delivers Events at least once, signed with HMAC-SHA256. Retries use backoff for up to 24 hours. After 3 days of continuous failure, the endpoint is disabled and the Admins are notified.
- Admin "Webhooks" screen (design canvas): add and edit endpoints, choose events, "include internal data" (off by default), rotate the signing secret, "Send test event", "Retry now", status, and a delivery log with the payload.

## Acceptance criteria

- [x] REST test: a ticket change and its outbox Event are both stored, or neither is.
  Evidence: `test/worker/webhooks.test.ts`, "stores a ticket change and its Event together" and "stores neither the change nor its audit entry when the Event cannot be written". The second test adds a trigger that makes the outbox insert fail; a PATCH, a new ticket and a comment each answer 500, and the ticket, its audit entries and the comment are unchanged.
- [x] Delivery test: the receiver gets a correct signature, `before`, `after`, and `changed`.
  Evidence: "delivers a signed Event with before, after, changed and actor". The test checks the `webhook-signature` with its own Standard Webhooks verifier (not the server code), `webhook-id` = `event_id`, `before`/`after` with `number` and `ref`, `changed` = `assignee`, `page_or_feature`, `status`, and that `after` equals the REST view (`status`, `updated_at`). A second run sends nothing more.
- [x] Delivery test: an endpoint without "include internal data" never gets Internal Comments or internal Field data.
  Evidence: "never sends Internal Comments to an endpoint without "include internal data"": the plain endpoint gets `ticket.created` and the Public Comment only, and no body contains the internal text; the internal endpoint gets all three. Fields have no visibility of their own (DECISIONS 3.6), so no Field value is internal; see the decision below.
- [x] Delivery test with a test clock: failures retry with backoff, stop after 24 hours, and disable the endpoint after 3 days.
  Evidence: "retries with backoff, gives up after 24 hours, and turns the endpoint off after 3 days". The test runs the scheduled handler of the built Worker with `scheduledTime` as the clock. It follows the retry time that the API shows, checks that a run 1 s before it sends nothing, that the gaps grow from 1 minute, that the last attempt is within 24 hours and the delivery then is `failed`, that the endpoint is still on at day 2, and off at day 3 with no pending deliveries and no new deliveries. "a success clears the failure state" covers recovery.
- [x] Delivery test: a repeated delivery has the same `event_id`.
  Evidence: the backoff test (9 attempts, one `event_id` in body and header) and "\"Send test event\" and \"Retry now\" send at once" (the retried `ticket.created` has the same `event_id`).
- [x] Rotating the secret changes the signature of the next delivery.
  Evidence: "a rotated secret signs the next delivery, and the old one no longer verifies". "shows the secret only on create and rotate, and stores it encrypted" checks that the list never has it and the database row does not hold it in plain text.

Other tests in `test/worker/webhooks.test.ts`: only chosen events and no events to an endpoint that is off; the delivery log returns the exact signed payload; purge after 30 days; Admin-only routes (403 for an Agent, 401 without a session); 16 refused URLs (http, localhost, IPv4 private, decimal IPv4, metadata address, IPv6 loopback, link-local, unique local and mapped, `.local`, `.internal`, credentials); events validation and unknown keys; edit and delete.

Playwright: `e2e/webhooks.spec.ts`: the Admin opens Webhooks from the sidebar, adds an endpoint (internal data off by default), sees the `whsec_` secret once, sends a test event to a path that refuses it, sees the "Test event failed" toast, the Failing badge and "Retry now", and opens the payload in the delivery log.

Checked by hand in the browser against `wrangler dev` on 2026-10-18: empty state, add form, secret dialog, Healthy and Failing cards, "Send test event", "Retry now" (tries count goes up, "Next try in 1 minute"), the delivery log with Show/Hide payload, the edit dialog with the rotate confirmation. Light and dark mode. At 375 px `scrollWidth` is 375; the delivery log scrolls inside its own box, as on the canvas.

## Not verified

- The Cron Trigger on a deployed Worker. Tests call the `scheduled` handler of the built Worker directly; `wrangler dev` serves `/__scheduled` from static assets (the path is not in `run_worker_first`), so the cron was not run by hand. "Send test event" and "Retry now" use the same delivery code in a request.
- CPU time of a delivery run on Workers. Each run does at most 3 rounds of 10 deliveries; signing and the secret key use Web Crypto, and the payload is stored text, so no JSON is built or parsed for a delivery.
- The loading skeleton and the error state of the page were not seen in the browser.
- The disabled-endpoint notice to Admins: only a log line until issue 18 (see notes).

## Decisions made here

1. **`before` and `after` are built by D1, not by the Worker.** `withEvent` (`server/utils/outbox.ts`) adds SQL statements around the change in the same `db.batch`: an insert of the Event with `before` = `json_object(...)` of the ticket row (read before the update), the change statements, an update that sets `after` with `json_set` (read after them), and an insert-select of the deliveries. So the snapshots are exact, cost no Worker CPU (2.6), and need no extra round trip. The payload is stored as the final JSON text and sent and signed as is, so a retry sends the same bytes. A new ticket uses `(SELECT max(number) FROM ticket)` for its number, because D1 runs one batch at a time.
2. **The ticket view in payloads** is the REST `TicketDetail` without `comment_count`, `allowed_actions` and `schema_fields` (they depend on the reader): `number`, `ref`, `title`, `description`, `priority`, `status {key,name,category}`, `ticket_type {id,name,prefix}`, `team`, `requester {id,name,email}`, `assignee`, `schema_version`, `fields`, `channel`, `created_at`, `updated_at`, with the same time format as the API.
3. **Payload**: `{ event_id, type, created_at, changed, actor, before, after }`, plus `comment {id, visibility, body, channel, author, created_at}` for `comment.created`. `before` is null for `ticket.created`. `actor` is `{ kind: 'user', id, name, channel }` (issue 12 adds `kind: 'application'`). `changed` holds `status`, `priority`, `assignee` (the ticket view keys) and Field Keys; it is `[]` for creation and comments.
4. **What is internal** is one function, `isInternal(event)` in `server/utils/outbox.ts`: an Event that carries an Internal Comment. DECISIONS 3.6 says there are no permissions for individual Fields, so no Field value is internal, and the ticket view has no comments. Filtering happens at fan-out: an internal Event gets no delivery row for an endpoint without "include internal data". If Fields ever get a visibility, it goes in this function.
5. **Fan-out at write time.** Deliveries are made in the batch of the Event, for each endpoint that is on and wants the type. An endpoint added later does not get older Events. Unique (`event_id`, `endpoint_id`).
6. **Delivery = Cron Trigger every minute** (`wrangler.jsonc` `triggers.crons`), through Nitro's `cloudflare:scheduled` hook in `server/plugins/outbox.ts`. No custom entry was needed. `controller.scheduledTime` is the clock, so tests control time. A run sends at most 3 rounds of 10 due deliveries in parallel, each fetch with a 10 s timeout, and stops starting rounds after 20 s; results go back in one `db.batch` for each round. The run then purges Events older than 30 days (9.3) with their deliveries, in every state.
7. **Signing = Standard Webhooks.** Headers `webhook-id` (= `event_id`, the same on every retry), `webhook-timestamp` (seconds), `webhook-signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">`. The secret is `whsec_` + 32 random bytes in base64. Receivers can use any Standard Webhooks library. Rotation stops the old secret at once (no overlap window).
8. **Secret storage.** The Worker must sign, so the secret cannot be a hash. It is stored AES-256-GCM encrypted with a key derived by HKDF from `BETTER_AUTH_SECRET` (info `webhook-signing-secret`), with the endpoint ID as additional data. A copy of the database alone does not give the secrets. Changing `BETTER_AUTH_SECRET` makes every stored secret unreadable: rotate each endpoint's secret after that. The secret is in the response of create and rotate only.
9. **Backoff**: after failed attempt 1, 2, 3, 4, 5, 6+ wait 1 min, 5 min, 15 min, 1 h, 3 h, 6 h. A retry that would be later than 24 hours after the Event is not planned; the delivery becomes `failed`. Each delivery gets at least one attempt, even when it is older than 24 hours (for example after the endpoint was off). Success = any 2xx. Redirects are not followed (a 3xx is a failure).
10. **Auto-disable**: `failing_since` is the first failed attempt since the last success; `failures` counts them. A failed attempt 3 days or more after `failing_since` turns the endpoint off (`enabled = false`, `disabled_at`), marks its pending deliveries `failed`, and calls `notifyAdminsEndpointDisabled`. Turning it on again (PATCH `enabled: true`) clears the failure state. An Admin who turns it off keeps the pending deliveries; they are sent when it is on again.
11. **"Retry now"** is for the endpoint: all its pending deliveries become due and are sent in the request. **"Send test event"** writes a `webhook.test` Event with one delivery for that endpoint and sends it in the request; it retries like any Event. Both answer 409 `ENDPOINT_OFF` when the endpoint is off.
12. **SSRF.** The URL must be `https`; `http` and `https` to `localhost`, `127.0.0.1` and `[::1]` only when `APP_ENV=development`. Refused by name: `localhost`, `*.localhost`, `.local`, `.internal`, `.intranet`, `.lan`, `.home.arpa`; IPv4 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, 198.18/15, 224/3; IPv6 `::1`, `::`, `::ffff:*`, fc00::/7, fe80::/10; URLs with credentials. The URL parser turns other IPv4 forms into dotted form first. What Workers **cannot** check: a Worker cannot resolve a name or see the address that `fetch` connects to, so a public name that resolves to a private address passes this check (DNS rebinding included). The mitigation is the platform: outbound `fetch` leaves from Cloudflare's network, which has no route to the owner's private network, and redirects are not followed.
13. **Endpoint table and issue 15.** `webhook_endpoint.owner` is `'admin'` today; issue 15 adds `'application'` and an `application_id` column, and filters fan-out by it. Admin routes and lists only see `owner = 'admin'`.
14. Routes (Admin only): `GET/POST /api/v1/webhooks`, `PATCH/DELETE /api/v1/webhooks/{id}`, `POST /api/v1/webhooks/{id}/rotate-secret`, `POST /api/v1/webhooks/{id}/test`, `POST /api/v1/webhooks/{id}/retry`, `GET /api/v1/webhooks/{id}/deliveries` (50 newest, no payloads), `GET /api/v1/webhooks/{id}/deliveries/{deliveryId}` (with `payload`, the exact signed text).
15. **UI.** `/webhooks` (Admin), sidebar item "Webhooks" before Settings. The log shows one endpoint: the first failing one by default, another through its "Deliveries" button. The canvas links to the Applications page; that page does not exist yet (issue 12), so the subtitle has no link. A Delete action is in the edit dialog, with a confirmation.
16. Migration `0006_issue_14_outbox_and_webhooks.sql` (renumbered at merge): tables `webhook_endpoint`, `outbox_event`, `webhook_delivery`.

Copied to DECISIONS.md (rows 8.16 to 8.23).

## Glossary terms to add

- **Delivery**: one Event for one Webhook Endpoint, with its attempts and result. The delivery log of an endpoint lists them. Kept 30 days.
- **Signing secret**: the secret of one Webhook Endpoint that signs each delivery (HMAC-SHA256, Standard Webhooks). Shown once, on create and rotate.

Copied to CONTEXT.md.

## Notes for later issues

- **Every ticket change already writes its Event** through `applyChange` (`ticket.updated`), `createTicket` (`ticket.created`) and `createComment` (`comment.created`). A new kind of change (issue 08 type change, 09 Requester edits) that goes through `applyChange` needs nothing more. Code that writes a ticket in another way wraps its statements: `db.batch(withEvent(db, principal, { type, ticketNumber, changed }, [...statements]))`.
- **Issue 18 (Inbox):** fill `notifyAdminsEndpointDisabled(db, endpoint)` in `server/utils/webhooks.ts` with one Inbox notification for each Admin, opening `/webhooks`. Today it only logs a warning.
- **Issue 16 (custom Worker entry `server/entry.ts`):** the entry must still forward `scheduled` to Nitro's handler, or the `cloudflare:scheduled` hook in `server/plugins/outbox.ts` never runs and no webhook is delivered. Keep `triggers.crons` in `wrangler.jsonc`.
- **Issue 15 (Application webhook):** add `'application'` to `webhook_endpoint.owner` and an `application_id` column; extend the fan-out SQL in `outbox.ts` (`fanOut`) with "the ticket's source Application is this endpoint's Application", and refuse internal Events for those endpoints (8.6). The delivery code, signing, retries and log work as they are. Add the column at the end of the `webhook_delivery` insert-select too, if one is added there (the insert names every column, so a missing one fails loudly).
- **Issue 12 (Application as Principal):** `actorJson` in `outbox.ts` reads the `user` table; an Application actor needs `kind: 'application'`.
- **Issue 22 (Erasure):** payloads hold ticket and comment text. Erasure should also delete (or blank) `outbox_event.payload` for the Contact's tickets (`outbox_event.ticket_number`), not only wait for the 30-day purge.
- **Issue 23 / 24:** the cron runs every minute and does 2 to 4 D1 queries when there is nothing to send.
- `wrangler dev` cannot trigger the cron at `/__scheduled` because static assets answer that path first.

## Blocked by

- [06 · Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md)
