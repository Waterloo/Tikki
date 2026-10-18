# 12 · Applications, API keys, and tickets for Contacts

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Other systems create tickets for their customers through the REST API, inside a strict data boundary.

- Admin "Applications" screen (design canvas): create an Application with a name, description, permissions (`tickets:create`, `tickets:read`, `tickets:update`, `comments:create`), and allowed Ticket Types. Disable and enable it.
- API keys: start with `gt_live_`, shown in full once, stored hashed. The list shows the first characters, created date, last use, and Revoke.
- A ticket created with a key has a **Contact** as Requester. A Contact is unique on (Application, external ID) and has a name and email.
- An Application can read only the tickets it created, and never Internal Comments.
- `Idempotency-Key` on create: the same key within 24 hours returns the first result.
- The OpenAPI spec is generated from the same definitions that validate requests and is served by the Worker.
- One error format: `code`, `message`, `details`.

## Acceptance criteria

Checked on 2026-10-18. `pnpm test` (142 tests, 13 files), `pnpm typecheck`, and `E2E_PORT=8814 pnpm e2e` (6 tests) pass. All REST tests are in `test/worker/applications.test.ts`.

- [x] REST test: a create with a valid key and an allowed type makes a ticket with a Contact as Requester.
  Evidence: "creates a ticket with a Contact as Requester for a valid key and an allowed type". The answer has `requester.kind: "contact"`, `channel: "api"`, and the `application`; an Agent sees the same Requester; the row has `requester_id` NULL and `contact_id` set.
- [x] REST test: a type not in the allowed list is refused. A revoked key is refused.
  Evidence: "refuses a type that is not in the allowed list, the same as a type that does not exist" (403, nothing created), "refuses a revoked key at once" (401 on the next request), "refuses every key of a disabled Application, and accepts them again when enabled" (403 `APPLICATION_DISABLED`), "refuses unknown and malformed keys, and never falls back to the session cookie", "refuses a create without tickets:create, and a read without tickets:read".
- [x] REST test: the same external ID twice gives the same Contact. The same email from two Applications gives two Contacts.
  Evidence: "gives the same Contact for the same external ID, and keeps its newest name and email" and "gives two Contacts for the same email from two Applications".
- [x] REST test: Application A cannot read Application B's tickets or any internal-only data.
  Evidence: "lets Application A read only its own tickets: not B's, not a User's" (404 with the same body as a missing ticket; the list and counts hold only A's ticket), "shows an Application only its allowed Ticket Types", "refuses the Admin routes to an API key", "refuses Agent changes and the "me" filters from an Application". Internal Comments do not exist yet (issue 06); "never lets an Application see or add Internal Comments" tests the policy rules that issue 06 must use.
- [x] REST test: a repeated `Idempotency-Key` returns the same ticket and creates nothing new.
  Evidence: "returns the first ticket for a repeat and creates nothing new", "creates one ticket for two concurrent requests with one key", "answers 409 for the same key with another body, and creates nothing", "keeps keys apart for each Application, and lets a key expire after 24 hours", "does not record a key when the create fails".
- [x] REST test: the served OpenAPI document validates and lists the create endpoint.
  Evidence: "serves a valid OpenAPI 3.1 document that lists the create endpoint". "Validates" is a structural check written in the test (OpenAPI 3.1 fields, each `$ref` resolves, each path parameter is declared, each operation has responses), not a full OpenAPI schema validator: every validator uses Ajv, and Ajv needs `eval`, which workerd forbids (4.16). The test also checks that the `TicketCreate` schema has the zod rules (required keys, Priority options).
- [x] Only a hash of the key is in the database.
  Evidence: "keeps only a SHA-256 hash of the key, and the shown prefix": `key_hash` is the SHA-256 of the key, no column holds the secret part, and the Admin detail never shows it again.

Also: `e2e/applications.spec.ts` (Playwright): an Admin creates an Application with an allowed type, creates a key, sees it once, creates a ticket with it through the API, revokes it (the next call is 401), and disables the Application.

## Not verified

- The screens were checked with headless Playwright screenshots against `wrangler dev` (port 8804), not in the shared browser pane, because another agent was driving it. Seen: the empty state, the New application dialog, the detail with a new key, the key list, light and dark mode at 1440 px, and 375 px (no horizontal scroll, key rows become cards). Not seen: the loading skeleton, the error state, the Revoke dialog in dark mode.
- CPU per route was not measured on Cloudflare. Locally, a key check is one indexed query plus a SHA-256; the OpenAPI document is built at build time (a cold first request took 4 ms wall time instead of 17 ms).
- Copy on the new key needs `navigator.clipboard`; the click was not exercised.

## Decisions made here

- **Principal is a union** in `server/utils/tickets.ts`: `UserPrincipal { kind: 'user', userId, role, channel: 'web' | 'ai' }` or `ApplicationPrincipal { kind: 'application', applicationId, permissions, ticketTypeIds, channel: 'api' }`. An Application has no Role. Code that needs a User takes `UserPrincipal` (MCP, `createTicket`), so TypeScript refuses an Application there.
- **`restPrincipal`**: a request with an `Authorization` header is an Application (`Bearer gt_live_...`) and is never read as a session, so a bad key cannot fall back to a cookie. Without the header it is the web session. `sessionPrincipal` is the session only. `adminPrincipal` uses `isAdmin` from the policy, which is false for every Application.
- **Refusals for keys**: unknown, malformed, and revoked keys give the same 401 `UNAUTHENTICATED`. A disabled Application gives 403 `APPLICATION_DISABLED`, because the caller has a real key and must know why it stopped. Each request reads the key and the Application in one query, so revoke and disable act at once.
- **Key format and storage**: `gt_live_` and 32 random bytes in hex. Only the SHA-256 (hex) and the first 12 characters (`gt_live_` + 4) are stored. A fast hash is enough because the key has 256 bits of entropy; a slow hash would spend the CPU budget of each request. The lookup is by hash through a unique index, so no stored secret is compared byte by byte, and no constant-time compare is needed. `last_used_at` is written at most once a minute, to keep a D1 write off most requests. Revoked keys stay in the table with `revoked_at`, and the Admin list hides them.
- **Requester of a ticket**: `ticket.requester_id` (User) and `ticket.contact_id` (Contact) are both nullable with `CHECK ((requester_id IS NULL) <> (contact_id IS NULL))`, so a ticket has exactly one Requester. The source Application is the Contact's Application; it is not stored on the ticket, so it cannot disagree with the Contact. The API returns `requester: { kind: 'user', id, name, email } | { kind: 'contact', id, external_id, name, email }` and `application: { id, name } | null`.
- **Contact upsert**: a create sends `contact: { external_id, name, email }`. The Contact is found by (Application, external ID); the name and email sent replace the stored ones, so the newest values win.
- **Allowed types and permissions** are JSON lists on the `application` row, so one row read gives the whole Principal. The Admin routes refuse unknown type IDs. An Application sees only its allowed types in `GET /api/v1/ticket-types`, and another type answers 404. A create with a type that is not allowed answers 403 `FORBIDDEN`, also when the type does not exist, so an Application cannot probe for types.
- **Permissions in the policy**: `tickets:read` is needed to read or list (403 without it, for its own tickets; another source's ticket is 404 first). The create answer is shown also without `tickets:read`. `tickets:update` is stored but used by no action yet: the Agent actions refuse an Application with 403. Issue 13 adds cancel and reopen behind it.
- **"Visible to all" does not show a Contact's ticket to Requesters.** That flag is for internal tickets; a Contact's ticket holds customer data, so only staff and the source Application see it (`canRead` and `readableTickets`).
- **Idempotency-Key**: only for Applications (a User's header is ignored). The key is 1 to 255 visible ASCII characters. The first create writes the Contact, the ticket and an `idempotency_key` row in one `db.batch`, which D1 runs as one transaction; the row's primary key (Application, key) makes a concurrent repeat fail as a whole, and that request then answers with the first ticket. A repeat in 24 hours answers 201 with the ticket as it is now and the header `Idempotent-Replayed: true`. The same key with another body (SHA-256 of the raw body) answers 409 `IDEMPOTENCY_KEY_REUSED`. Expired rows of the Application are deleted in the same batch, so the table stays small without a cron job. A failed create records no key.
- **OpenAPI**: `GET /api/v1/openapi.json`, public, OpenAPI 3.1. The request schema is `z.toJSONSchema` of the same zod parts that `createApplicationTicket` validates with (`coreInput`, `typeInput`, `contactInput`). The response schemas are zod objects in `server/utils/openapi.ts` with a compile-time check that each one equals its TypeScript view, so a changed view fails `pnpm typecheck`. The document is built at build time (a Nitro virtual module in `nuxt.config.ts`, loaded with `jiti`, now a dev dependency), because building it takes about 10 ms of CPU. It describes the routes an Application uses; Admin and web routes are not in it.
- **Error format**: every new route uses `apiError` (`{ error: { code, message, details } }`). A body that is not JSON answers 400 `INVALID_JSON` (`readJson` in `rest.ts`) instead of the h3 error shape. New codes: `APPLICATION_DISABLED`, `IDEMPOTENCY_KEY_REUSED`, `INVALID_IDEMPOTENCY_KEY`, `INVALID_JSON`.
- **Admin routes**: `GET/POST /api/v1/applications`, `GET/PATCH /api/v1/applications/{id}` (`name`, `description`, `permissions`, `ticket_type_ids`, `enabled`), `POST /api/v1/applications/{id}/keys` (`{ name }`; the answer has the full `key` once, with `Cache-Control: no-store`), `DELETE /api/v1/applications/{id}/keys/{keyId}` (revoke, 204).
- **UI**: `/applications` opens the first Application; `/applications/{id}` is the detail (`app/pages/applications/[[id]].vue`). A key gets a name in a small dialog (the canvas list has names, but no way to enter one). Permissions and allowed types save at once, with a toast. The canvas "Rate limit" row (issue 23) and the webhook section (issue 15) are not built. The subtitle leaves out "gets updates through its own webhook" until issue 15. The sidebar item "Applications" is current on every `/applications/...` page (`NavItem.prefix`). The first-run screen links to Applications and the OpenAPI document (the note from issue 21).
- Migration `0004_issue_12_applications.sql` (renumbered at merge): tables `application`, `api_key`, `contact`, `idempotency_key`, and a rebuild of `ticket` for the nullable `requester_id`, the new `contact_id`, and the CHECK. The rebuild was edited by hand: `PRAGMA defer_foreign_keys = on` instead of `foreign_keys=OFF` (D1 ignores that), `NULL` for the new column in the copy (drizzle-kit selected a column the old table does not have), and the `sqlite_sequence` value is carried over, so the global counter never reuses a number (4.9). Checked with `wrangler d1 migrations apply` on a database with tickets: rows kept, the next number continues after the highest one ever used.

## Glossary terms to add

- **API key**: The secret an Application sends to use the API. It starts with `gt_live_`, is shown once, and only its hash is kept. An Admin can revoke it.
- **Idempotency-Key**: A header on a create. The same key from the same Application within 24 hours gives the first ticket again and creates nothing.

## Notes for later issues

- **Issue 06 (comments)**: use `canReadInternalComments(principal)` from `policy.ts` to filter comments on every channel and in every payload; it is true only for Agents and Admins, so an Application and a Requester never get Internal Comments. Use `authorizeApplicationComment(principal, ticket, internal)` for a comment from an Application (needs `comments:create`, own ticket, Public only); add the User rules next to it. If the `comment` table references `ticket`, its migration must run before or after this one's `ticket` rebuild with `PRAGMA defer_foreign_keys = on` (this migration already has it).
- **Issue 13 (Application actions)**: add `cancel` and `reopen` to `TICKET_ACTIONS` and allow them for an Application with `tickets:update` on its own tickets. Decide what an Application sees of the assignee: the ticket view now shows the assignee's name and email to the Application.
- **Issue 15 (Application webhooks)**: a ticket's Application is `contact.application_id` through `ticket.contact_id`.
- **Issue 20/22 (Contacts, Erasure)**: Contacts have `name`, `email`, `external_id`; `DELETE /api/v1/contacts/{id}` must check that the Contact belongs to the calling Application.
- **Issue 23 (rate limits)**: limits per key go on `api_key` or `application`; the Applications screen has room for the canvas "Rate limit" row.
- Any new REST route gets Applications automatically through `restPrincipal`. Use `sessionPrincipal` or `adminPrincipal` for routes that are for Users only, and put the rule in `policy.ts`.
- `GET /api/v1/tickets?requester=me|assignee=...` answers 422 for an Application; `listTickets` throws if it gets these filters with an Application.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
