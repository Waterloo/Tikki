# Design decisions

Record of the initial design session on 2026-10-18. Terms are defined in [CONTEXT.md](../CONTEXT.md).
`Qn` is the question number from that session. Record each new decision after this one as an ADR in `docs/adr/`.

Each item is one of:
- **Decided**: the owner chose it explicitly.
- **Delegated**: Claude decided, because the owner asked Claude to make the decisions that do not need the owner. The owner can change any of them.

## 1. Purpose and scale

| # | Decision | Status |
|---|---|---|
| 1.1 | Main purpose: people raise issues and requests. Admins define the Ticket Types (Bug, Data request, Payment issue, ...). | Decided |
| 1.2 | Tickets are created in three ways: the web app, the AI assistant (MCP / Claude connector), and the REST API for other Applications. | Decided |
| 1.3 | Expected scale: fewer than 20 internal Requesters, 2–4 Agents, fewer than 10 tickets each day (Q7). Every mechanism must make sense at this scale. | Decided |
| 1.4 | Production quality from the first deploy. | Decided |

## 2. Platform and deployment

| # | Decision | Status |
|---|---|---|
| 2.1 | One organization for each instance, with no tenant column. Each organization deploys its own instance (Q1). | Decided |
| 2.2 | Stack: Nuxt 4, Better-Auth, one Cloudflare Worker, D1 (through Drizzle), R2 (Q6). | Decided |
| 2.3 | One Worker serves the static UI, the REST API, and the MCP endpoint. No Durable Objects. | Decided |
| 2.4 | The web UI is an SPA (`ssr: false`) and uses the same REST API as Applications (Q21). | Decided |
| 2.5 | Two Deploy Profiles: `paid` (email on) and `free` (email off). No other feature is different (Q34). | Decided |
| 2.6 | The Free plan is a hard constraint. Each route must stay below 5 ms CPU, and CI checks this budget in staging (Q24). | Decided |
| 2.7 | The owner's instance runs on Workers Paid (Q15). | Decided |
| 2.8 | Week 1 is a walking skeleton: a Nuxt Worker with Better-Auth (email OTP sign-in) and MCP, one `create_ticket` tool, connected to claude.ai, deployed to staging with real migrations. This tests the two largest risks first (Q15). | Decided |

Facts verified on 2026-10-18 that the design depends on:
- Workers Free: 10 ms CPU for each request. Time spent waiting on D1, R2 or `fetch` does not count. Startup limit 1 s. Request body limit 100 MB.
- Better-Auth 1.7: use `@better-auth/mcp` (built on `@better-auth/oauth-provider`) and `@better-auth/cimd`. `oidcProvider` and the old MCP plugin no longer exist. Keep the legacy (stateless) mode on, because Claude does not list MCP spec 2026-07-28. Turn on DCR as a fallback. CIMD on Workers needs a secure transport that we write ourselves.
- Better-Auth on D1: needs `nodejs_compat`. With Drizzle, set `transaction: false`.
- Nuxt 4.6 runs on Nitro v2. Bindings are at `event.context.cloudflare.env`.
- Cloudflare recommends a stateless MCP handler (`createMcpHandler`). `McpAgent` is feature-frozen.
- D1 `batch()` is atomic. Size limit: 500 MB on Free, 10 GB on Paid. `wrangler d1 export` fails when FTS5 tables exist.
- Claude connectors: Streamable HTTP, OAuth 2.1 with S256 PKCE, DCR or CIMD. The `resource` value must equal the MCP URL exactly, refresh tokens must rotate, and the server must respond within 10 s.
- Cloudflare Email Sending: public beta. Arbitrary recipients only on Workers Paid. The sending domain must use Cloudflare DNS.
- Claude cannot pass a file from the chat to an MCP tool as binary. The MCP spec has no upload mechanism (an experimental extension exists).

## 3. Identity and access

| # | Decision | Status |
|---|---|---|
| 3.1 | The **first** sign-in method is a one-time email code (email OTP). OIDC SSO (Google, Microsoft, generic OIDC) comes after the walking skeleton (issue 25). (Q32, revised by the owner.) | Decided |
| 3.2 | Email OTP needs a mail transport. When the transport is `none`, the instance must have at least one SSO provider. | Decided |
| 3.2a | No magic links. Mail scanners (for example Outlook Safe Links) open single-use links before the user does. The Claude connector sign-in runs in a popup or the system browser, and a link opens elsewhere, so the OAuth flow does not complete. Phone mail apps open links in their own built-in browser. A code is typed into the same window. | Decided (owner chose the code over a magic link) |
| 3.2b | A public release needs at least one sign-in method that works without email (SSO), so that the `free` profile can sign in. | Delegated |
| 3.3 | No passwords. This removes reset flows, breach risk, and the CPU cost of hashing on Free (Q15, Q32). | Decided |
| 3.4 | Roles: Admin, Agent, Requester (Q10). | Decided |
| 3.5 | Agents see all tickets. Requesters see only their own tickets (Q10). | Decided |
| 3.6 | Each Ticket Type has a flag "visible to all internal Users". There are no permissions for individual fields (Q10). | Decided |
| 3.7 | External people are Contacts. They never sign in. Applications create tickets for them, and they get updates only through their Application (Q8). | Decided |
| 3.8 | A Contact is unique on (Application, external ID). The same email from two Applications gives two Contacts, and they are not merged automatically (Q17). | Decided |
| 3.9 | Applications use API keys. A key is shown once and stored hashed (Q13). | Decided |
| 3.10 | An API key has scopes (`tickets:create`, `tickets:read`, `tickets:update`, `comments:create`) and a list of allowed Ticket Types (Q18). | Decided |
| 3.11 | An Application can read only the tickets it created (Q18). | Decided |
| 3.12 | OAuth client credentials for Applications come later, behind the same Application principal (Q13). | Decided |
| 3.13 | Bootstrap: the first sign-in whose email matches `ADMIN_EMAIL` becomes Admin. After that, the variable has no effect (Q25). | Decided |
| 3.14 | A new User gets the Requester role. An Admin promotes Users. | Delegated |
| 3.15 | `ALLOWED_EMAIL_DOMAINS` is required when Google, Microsoft or email OTP is on. If it is missing, the Worker does not start and shows a clear error. It is optional for a generic OIDC provider (Q42). | Delegated |
| 3.16 | An Admin can invite individual emails from other domains, for example contractors (Q42). | Delegated |
| 3.17 | The Admin role includes everything an Agent can do. | Delegated |
| 3.18 | Users are deactivated, never deleted, so the Activity always shows who did what. A User has one of three states: invited, active, deactivated. | Delegated |
| 3.19 | An API key starts with `gt_live_` and is shown in full only once. The UI shows its first characters, when it was created and last used, and a Revoke action. | Delegated |

## 4. Tickets, types, and fields

| # | Decision | Status |
|---|---|---|
| 4.1 | v1 scope: three ways to create tickets, Admin-defined Ticket Types with Fields, fixed Statuses, Priority, assignee, comments, attachments, Activity, notifications, webhooks (Q4). | Decided |
| 4.2 | Fields are in v1. Without Fields, the AI cannot ask for the correct information (Q4). | Decided |
| 4.3 | Field data types: short text, long text, number, date, single select, multi select, checkbox, user, URL, file (Q14). | Decided |
| 4.4 | Each change to the Fields of a Ticket Type makes a new Schema Version. A ticket stays on the version it was created with (Q14, Q19, Q26). | Decided |
| 4.5 | Field Keys are stable, and the data type of a Field never changes across versions. Queries across versions use the Field Key (Q26). | Decided |
| 4.6 | Allowed: add a Field, rename a label, add or archive select options, archive a Field, make a Field required (for new tickets only). Not allowed: change a data type, hard-delete a Field (Q26). | Decided |
| 4.7 | A ticket moves to the newest Schema Version only when an Agent changes its Ticket Type (Q26). | Decided |
| 4.8 | An Agent can change the Ticket Type of a ticket. Values with matching Field Keys move to the new type. Other values stay visible in the Activity (Q20). | Decided |
| 4.9 | Ticket numbers come from **one global counter**. Each Ticket Type has its own **prefix**, so the displayed reference looks like `BUG-1047` or `PAY-1048`. The number is the identity and never changes (Q20, revised by the owner: option C). | Decided |
| 4.9a | When an Agent changes the Ticket Type, the number stays and only the prefix changes (`BUG-1048` becomes `PAY-1048`). Lookup uses only the number, so every old reference still opens the ticket in search, links and the API. A prefix for each type with its own counter (`BUG-12`) was rejected, because a type change would break references or leave a wrong prefix. | Decided |
| 4.9b | A prefix is 2–5 letters, and lowercase is changed to capitals automatically. It is suggested from the type name (`Access request` gives `ACC`) and can be edited. It must be unique across all types, including archived ones, so an old reference never reads as a different type. | Delegated |
| 4.9c | The API and webhook payloads carry both `number` (integer, the identity) and `ref` (display, for example `PAY-1048`). Integrations must store `number`. | Delegated |
| 4.10 | Statuses are rows, and each has one fixed Status Category (open, active, waiting, done). v1 seeds `open`, `in_progress`, `waiting`, `resolved`, `closed`. Users cannot edit them in v1 (Q29). | Decided |
| 4.11 | Priority is a core attribute of every ticket: `low`, `normal`, `high`, `urgent`. Default `normal`. The Requester or the AI sets it at creation, and Agents can change it (Q38). | Decided |
| 4.12 | Branch (Australia, Singapore, ...) is a normal Field. No data residency, so one D1 database (Q16). | Decided |
| 4.13 | Each Ticket Type has exactly one owning Team. An Agent can be in more than one Team. A new install makes one Team, "Support", and new Agents join it (Q9, Q40). | Delegated |
| 4.14 | Assignment is manual (Q9). | Decided |
| 4.15 | Each Ticket Type has an icon and a color. The UI uses them in the sidebar, in lists and in the ticket header. | Delegated |
| 4.15a | Creating a Ticket Type is one page: name, "when to use it" (required), icon, color, Team, visibility, Fields. Nothing is saved until "Create", so no draft state exists. Creating makes Schema Version 1, and the type can be used at once. | Delegated |
| 4.15b | The icon is suggested from the name, and the color is the first one that no other type uses. The Admin can change both. | Delegated |
| 4.15c | "When to use it" is required, because requesters see it and Claude uses it to choose the type. Each Field has help text, which Claude uses to ask for the value. | Delegated |
| 4.15d | A Field Key is generated from the label (`snake_case`). It can change until the type is created and is locked after that. A duplicate key is blocked when the Admin enters it. | Delegated |
| 4.15e | A name that an active type already uses is blocked. A name that an archived type uses links to "Restore" instead. | Delegated |
| 4.15f | Archiving a Ticket Type stops new tickets of that type. Old tickets keep it. The type can be restored. | Delegated |
| 4.16 | Validation is built from our own Field definitions. JSON Schema is output only (MCP tool schemas, OpenAPI). Reason: Ajv uses `eval`, and Workers do not allow it. | Delegated |
| 4.17 | Search: `LIKE` on title and description, plus filters. No FTS5, because it breaks `wrangler d1 export` backups (Q30). | Decided |
| 4.18 | Comments are Public or Internal. Agent comments are Internal by default (Q17). | Decided |
| 4.19 | An Application can add comments for its Contact (Q17). | Decided |
| 4.20 | A Requester can edit the description and Field values only while the Status Category is `open`. After that, the Requester can only add comments (Q39). | Delegated |
| 4.21 | A Requester can cancel a ticket at any time before `done`. It closes with the reason "cancelled by requester" (Q39). | Delegated |
| 4.22 | A Requester can reopen a `resolved` ticket within 14 days. After that, a new ticket is created and linked to the old one (Q39). | Delegated |
| 4.23 | An Application has the same Requester actions (4.20–4.22) for the tickets of its Contacts (Q39). | Delegated |
| 4.24 | An Admin can soft-delete a ticket. It is hidden everywhere and can be restored. No hard delete, except through Erasure (Q37). | Decided |

## 5. AI assistant (MCP)

| # | Decision | Status |
|---|---|---|
| 5.1 | The MCP server is a Claude custom connector. The AI acts as the signed-in User, with OAuth through Better-Auth. Better-Auth is the only authorization server; we do not also use `workers-oauth-provider` (Q5, Q6). | Decided |
| 5.2 | Tools cover Requester and Agent operations: read Ticket Types and their Fields, create, list, get, comment, assign, change Status, search (Q5). | Decided |
| 5.3 | The API enforces the role of the User. The prompt is never the security boundary (Q12). | Decided |
| 5.4 | No delete tool, and no bulk tools: one ticket for each call (Q12). | Decided |
| 5.5 | Write tools have MCP annotations, so Claude asks the User to confirm (Q12). | Decided |
| 5.6 | Each AI action is recorded as "via AI by <User>". Every change can be reversed from the Activity (Q12). | Decided |
| 5.7 | Ticket content goes back to the AI marked as untrusted user content (Q12). | Decided |
| 5.8 | AI attachments: inline text up to about 256 KB, plus an Upload Link tool. The link expires after 15 minutes, works once, is limited to one ticket, and requires the User's web session (Q33). | Decided |
| 5.9 | When Claude supports the MCP file-upload extension, we use it (Q33). | Decided |
| 5.10 | A validation error tells the AI what to fix: for each problem, the Field Key, label, reason, and allowed options. Claude can then ask the user for exactly the missing information. | Delegated |

## 6. REST API

| # | Decision | Status |
|---|---|---|
| 6.1 | Versioned path `/api/v1` (Q28). | Decided |
| 6.2 | The OpenAPI spec is generated from the same definitions that validate requests (Q28). | Decided |
| 6.3 | Create accepts an `Idempotency-Key` header. Keys are kept for 24 hours (Q28). | Decided |
| 6.4 | Cursor pagination. One error format: `{ error: { code, message, details } }` (Q28). | Decided |

## 7. Attachments

| # | Decision | Status |
|---|---|---|
| 7.1 | The R2 bucket is private. Each download goes through the Worker, with the same access check as the ticket (Q22). | Decided |
| 7.2 | Files are served with `Content-Disposition: attachment` (Q22). | Decided |
| 7.3 | Applications and the web UI upload with a raw streamed `PUT /api/v1/tickets/{id}/attachments`, with the filename in a header. No multipart, because parsing it uses CPU (Q27). | Decided |
| 7.4 | Maximum file size is 25 MB. Uploads must send `Content-Length`, because R2 needs to know the length. | Delegated |
| 7.5 | No malware scanning in v1 (Q22). | Decided |

## 8. Webhooks and notifications

| # | Decision | Status |
|---|---|---|
| 8.1 | Events: `ticket.created`, `ticket.updated` (with a `changed` list of Field Keys), `comment.created` (Q11). | Decided |
| 8.2 | Payload: the full ticket `before` and `after`, `actor`, and `event_id`. Fields use their Field Keys (Q11). | Decided |
| 8.3 | Delivery is at least once and signed with HMAC-SHA256, with retries and backoff. The admin UI shows a delivery log (Q11). | Decided |
| 8.4 | Outbox: the ticket change and its Event are written in the same D1 `batch()`, so no Event is lost. A Cron Trigger or a Queue then delivers it (Q11). | Decided |
| 8.5 | Admin Webhook Endpoints get all Events. Internal data goes only to endpoints marked "internal" (Q11). | Decided |
| 8.6 | An Application Webhook Endpoint gets only the Events for that Application's tickets, and only Public Comments (Q18). | Decided |
| 8.7 | Retries continue for up to 24 hours. After 3 days of continuous failure, the endpoint is disabled and the Admins are notified. | Delegated |
| 8.8 | The mail transport is one `send(message)` function. v1 has two production implementations: Cloudflare Email (Paid) and `none`. Other providers come only when a real self-hoster asks for one (Q32). | Decided |
| 8.8a | A third transport, `console`, writes each email (including sign-in codes) to the `wrangler dev` output, for local development only. The Worker refuses to start with `console` outside the development environment, because codes in Workers Logs would let log readers take over accounts. | Decided |
| 8.9 | The owner's instance uses Cloudflare Email. This needs Workers Paid and Cloudflare DNS on the sending domain. | Decided |
| 8.10 | Every notification also goes to the Inbox in the app, so the `free` profile still notifies Users. | Delegated |
| 8.11 | Applications and Webhooks are separate admin pages. An Application page has the Application's API keys, its permissions, and its **own** Webhook Endpoint. The Webhooks page has only the Admin endpoints (for example Slack or n8n). Reason: the two answer different questions ("who can create tickets?" and "where do we send all events?"), and they have different data limits. | Delegated |
| 8.12 | An Application has at most one Webhook Endpoint. Its events are fixed (`ticket.created`, `ticket.updated`, `comment.created`) and limited to its own tickets and Public Comments. The Admin cannot widen this. | Delegated |
| 8.14 | The Inbox groups notifications by day, and has "All" and "Unread" filters and "Mark all as read". Each notification opens its ticket or endpoint. When the list is empty, it says "You are up to date". | Delegated |
| 8.15 | Each User sets their email preferences on the Inbox page. "Assigned to me" is always on. The Inbox itself always gets every notification. | Delegated |
| 8.13 | Each endpoint has a signing secret that can be rotated, a "Send test event" action, and a delivery log. A failing endpoint shows when it started to fail, the next retry, and a "Retry now" action. | Delegated |

Notification rules (Q31, Decided):

| Event | Requester (internal) | Assignee | Owning Team | Source Application |
|---|---|---|---|---|
| Ticket created | confirmation | — | yes | yes |
| Assigned | — | yes | — | yes |
| Public Comment | yes | yes | — | yes |
| Internal Comment | never | yes | — | never |
| Status changed | yes | — | — | yes |

Users can turn off email for each event, except "assigned to me". There are no watchers in v1.

## 9. Privacy and retention

| # | Decision | Status |
|---|---|---|
| 9.1 | Personal data is only in the Contact record and in ticket content. The audit log records who did what and when, but not the values (Q36). | Delegated |
| 9.2 | Erasure: `DELETE /api/v1/contacts/{id}` (by the Application) or an Admin action. Name and email change to `[erased]`. The free text, Field values and Attachments of that Contact's tickets are removed, and their Activity entries lose their values (Q36). | Delegated |
| 9.3 | Delivered outbox rows (webhook payloads) are purged after 30 days (Q36). | Delegated |
| 9.4 | The audit log is append-only. Its facts are kept forever. Only Erasure removes its values (Q23, Q36). | Delegated |

## 10. Security limits

Rate limits (Q41, Delegated). An Admin can change the limits for each API key.

| Who | Limit |
|---|---|
| API key | 60 requests/min, of which 10 creates/min |
| User (web) | 120 requests/min |
| User through MCP | 30 tool calls/min, of which 10 writes/min |
| Sign-in endpoints, for each IP | 10/min |
| Email OTP, for each email address | 5/hour |

Before implementation, confirm that the Cloudflare rate-limiting binding is available on the Free plan. If it is not, use a counter in D1 for the sign-in and OTP limits only.

## 11. Production baseline (Q23, Decided)

- Two environments, `staging` and `production`, each with its own D1, R2 and secrets.
- Forward-only Drizzle migrations. CI runs them before each deploy.
- D1 Time Travel for restore, plus a nightly export to R2.
- Deploys only from GitHub Actions on merge. No manual deploy to production.
- Workers Logs, plus Sentry for errors. For self-hosters, Sentry is on only when a DSN is set.
- Rate limits as in section 10.

## 12. Open source

| # | Decision | Status |
|---|---|---|
| 12.1 | The project is open source, and nothing in it is specific to one company (Q24). | Decided |
| 12.2 | License: MIT (Q35). | Decided |
| 12.3 | Secrets and identity settings are environment variables. Business settings (Ticket Types with their prefixes, Fields, Teams, keys, webhooks) are in the admin UI (Q25). | Decided |
| 12.3a | The Settings page edits the organization name, the subtitle and the logo. Ticket prefixes are set on each Ticket Type (4.9). Settings shows the deployment values (address, connector URL, sign-in, profile, email sender) as read-only, because they come from the environment. | Delegated |
| 12.3b | The logo must be a PNG of 1 MB or less. SVG is not accepted, because an SVG file can contain script. Without a logo, the UI shows the first letter of the name. | Delegated |
| 12.3c | Admins start Erasure (9.2) from Settings › Privacy. They search by email or external ID. | Delegated |
| 12.4 | Install with a "Deploy to Cloudflare" button, plus docs for `wrangler`. Migrations run on each deploy (Q25). | Decided |

## 13. Product experience

| # | Decision | Status |
|---|---|---|
| 13.1 | **First Requester dopamine:** a user describes a problem to Claude in one sentence. Within 10 seconds Claude replies with `BUG-1`, the correct Ticket Type, and the Fields filled in. Claude asks only for what it cannot infer. The week-1 walking skeleton must show this (Q43). | Delegated |
| 13.2 | **First Requester aha:** "what is happening with my payment issue?" in Claude gives the real Status and the last Public Comment, and the user never opens the web app (Q43). | Delegated |
| 13.3 | **First Admin dopamine:** from "Deploy to Cloudflare" to the first ticket in less than 10 minutes (Q43). | Delegated |
| 13.4 | A new install has three example Ticket Types (Bug, Data request, General request), each with 2–3 Fields, and the "Support" Team. The Admin can edit or archive them (Q44). | Delegated |
| 13.5 | The first screen shows the Claude connector URL with a copy button and a suggested first prompt (Q44). | Delegated |
| 13.6 | While the user types a title in the web form, the form shows similar open tickets that this user can see (`LIKE`, no LLM) (Q45). | Delegated |

## 14. UI

Visual reference: [ui-reference.png](ui-reference.png). It is a reference for style and layout, not for features.

Design canvas (Claude Design, private): https://claude.ai/artifact/Edi1gHaRPELu8zUnXmvUxT. It has twelve screens: agent ticket list, ticket detail, requester new-ticket form, admin type list, admin new type, admin type editor, admin first run, teams and users, application detail, webhooks, inbox, and settings.

| # | Decision | Status |
|---|---|---|
| 14.1 | Use Nuxt UI (Tailwind based, MIT license). It matches the reference style and gives accessible components. | Delegated |
| 14.2 | Style: light neutral background, white surfaces, thin borders, rounded corners, a quiet sans-serif font, color only for meaning (Status Category, Priority, Ticket Type). Dark mode follows the system setting. | Delegated |
| 14.3 | Sidebar: the organization name and logo (no workspace switcher, because there is one organization for each instance), then Inbox, My tickets, Assigned to me (Agents), All tickets (Agents), then the list of Ticket Types with their icons, then Admin. | Delegated |
| 14.4 | The main view is a ticket list grouped by Status. Each group has a colored header with a count, and groups can collapse, as in the reference. Columns: number, title, Ticket Type, Priority, Requester, assignee, last update. | Delegated |
| 14.5 | Long text is cut with an ellipsis in lists and is shown in full on the ticket page. On narrow screens the sidebar collapses and the rows become cards. | Delegated |
| 14.6 | The empty, loading and error states of each list are designed, not left blank. | Delegated |

## 15. Not in v1

Workflows (custom Statuses, transitions, rules-based routing, for example by branch), SLAs, automations, reporting, watchers, Kanban view, Calendar view (tickets have no dates yet), direct messages, malware scanning, full-text search, OAuth client credentials, more mail providers, binary file transfer from the AI, LLM features in the web form.

Kanban is the first view to add after v1. Status changes already go through one API, so a Kanban view is only a UI addition.

## 16. Open questions

None.
