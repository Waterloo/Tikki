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
| 2.9 | The Worker has its own entry that handles the raw upload `PUT` routes before Nitro. Nitro's Cloudflare entry copies each request body into memory, which breaks streaming and the memory limit. (issue 16) | Delegated |
| 2.10 | A migration that rebuilds a table that other tables point to copies the rows aside, drops the table, and creates it again. The usual rebuild fails at COMMIT in D1. A rebuild keeps the ticket and audit counters, so a number is never used twice (4.9). (issues 12, 15) | Delegated |
| 2.11 | D1 has no interactive transactions. A check that must not race goes inside the write statement (a conditional UPDATE, a unique key or a CHECK), and the code reads the number of changed rows. Examples: claim an Upload Link, keep one Admin, repeat an Idempotency-Key. (issues 12, 17, 20) | Delegated |

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
| 3.11 | An Application can read only the tickets it created (Q18). It sees an Agent or Admin only as "Support", with no name and no email. The assignee field is empty, and a flag says only whether someone is assigned (changed in issue 13). | Decided |
| 3.12 | OAuth client credentials for Applications come later, behind the same Application principal (Q13). | Decided |
| 3.13 | Bootstrap: the first sign-in whose email matches `ADMIN_EMAIL` becomes Admin. After that, the variable has no effect (Q25). | Decided |
| 3.14 | A new User gets the Requester role. An Admin promotes Users. | Delegated |
| 3.15 | `ALLOWED_EMAIL_DOMAINS` is required when Google, Microsoft or email OTP is on. If it is missing, the Worker does not start and shows a clear error. It is optional for a generic OIDC provider (Q42). | Delegated |
| 3.16 | An Admin can invite individual emails from other domains, for example contractors (Q42). | Delegated |
| 3.17 | The Admin role includes everything an Agent can do. | Delegated |
| 3.18 | Users are deactivated, never deleted, so the Activity always shows who did what. A User has one of three states: invited, active, deactivated. | Delegated |
| 3.19 | An API key starts with `gt_live_` and is shown in full only once. The UI shows its first characters, when it was created and last used, and a Revoke action. | Delegated |
| 3.20 | A ticket that the Principal cannot read answers "not found", so its existence is not revealed. A change that a Principal may not make on a ticket it can read answers "forbidden". REST and MCP send the same refusal (issue 05). | Delegated |
| 3.21 | All permission rules live in one policy module. Pages may declare roles to hide screens, but the API is the boundary (issue 05). | Delegated |
| 3.22 | An API key is stored as SHA-256 plus its first 12 characters. A slow hash would use the CPU budget, and a key with 256 bits does not need one. `last_used_at` is written at most once each minute. (issue 12) | Delegated |
| 3.23 | A request with an `Authorization` header is an Application and never falls back to the web session. An unknown, malformed or revoked key gets the same 401. A disabled Application gets 403 `APPLICATION_DISABLED`, because the caller has a real key and must know why it stopped. (issue 12) | Delegated |
| 3.24 | An Application has no Role. Its permissions (3.10) are stored on the Application. Every action needs `tickets:read` first, because each answer holds ticket data. `tickets:update` allows cancel and reopen (4.23). The Agent actions are always refused with 403. (issues 12, 13) | Delegated |
| 3.25 | A create with a Ticket Type that the key does not allow answers 403, also when the type does not exist, so an Application cannot probe for types. A read of another type answers 404. (issue 12) | Delegated |
| 3.26 | A ticket has exactly one Requester: a User or a Contact. The source Application is the Contact's Application and is not stored on the ticket, so the two cannot disagree. A create sends the Contact data, and the newest name and email replace the stored ones. (issue 12) | Delegated |
| 3.27 | A Contact's ticket holds customer data, so only staff and the source Application can read it. "Visible to all internal Users" (3.6) does not show it to Requesters. (issue 12) | Delegated |
| 3.28 | Deactivation (3.18) also deletes the User's sessions, tokens and Team memberships, and every sign-in method refuses new sessions. Reactivation clears only the flag: the User signs in again, and an Admin adds the User to the Teams again. (issue 20) | Delegated |
| 3.29 | An Admin cannot deactivate themself. The last active Admin cannot lose the role. The check is part of the UPDATE statement (2.11), so two Admins cannot demote each other at the same time. (issue 20) | Delegated |
| 3.30 | An invite lets one email outside the allowed domains sign in (3.16). The invite sets the role and Teams (3.33). An unused invite expires after 30 days, and "Resend" starts 30 days again. After the first sign-in it never expires. An Admin removes an unused invite and stops a used one by deactivation. (issue 20, changed in issue 28) | Delegated |
| 3.31 | After sign-in, the page goes back only to a path on this site. A path that starts with `//` or `/\` is refused. (issue 17) | Delegated |
| 3.32 | A Ticket Type can be "Participants only". Its tickets are Restricted tickets: only their Participants and the Admins see them, also when the other person is an Agent. Admins see them, because they manage Erasure, delete and the audit log, and a ticket that one person alone can see is lost when that person leaves. For everyone else a Restricted ticket answers "not found". (issue 27) | Decided |
| 3.33 | An invite sets the role (Requester by default) and, for Agents and Admins, the Teams. They are applied in the step that creates the User at the first sign-in, so a User never exists with the wrong role. An Admin can also invite an email on an allowed domain, only to set its role and Teams in advance. (issue 28) | Decided |

## 4. Tickets, types, and fields

| # | Decision | Status |
|---|---|---|
| 4.1 | v1 scope: three ways to create tickets, Admin-defined Ticket Types with Fields, fixed Statuses, Priority, assignee, comments, attachments, Activity, notifications, webhooks (Q4). | Decided |
| 4.2 | Fields are in v1. Without Fields, the AI cannot ask for the correct information (Q4). | Decided |
| 4.3 | Field data types: short text, long text, number, date, single select, multi select, checkbox, user, URL, file (Q14). | Decided |
| 4.4 | Each change to the Fields of a Ticket Type makes a new Schema Version. A ticket stays on the version it was created with (Q14, Q19, Q26). | Decided |
| 4.5 | Field Keys are stable, and the data type of a Field never changes across versions. Queries across versions use the Field Key (Q26). | Decided |
| 4.6 | Allowed: add a Field, rename a label, add or archive select options, archive a Field, make a Field required (for new tickets only). Not allowed: change a data type, hard-delete a Field (Q26). Making a Field not required is also allowed (issue 07). | Decided |
| 4.7 | A ticket moves to the newest Schema Version only when an Agent changes its Ticket Type (Q26). | Decided |
| 4.8 | An Agent can change the Ticket Type of a ticket. A value moves to the new type only when the Field Key and the data type both match, and a select value is a known option of the new Field. Other values stay visible in the Activity (Q20, changed in issue 08). | Decided |
| 4.9 | Ticket numbers come from **one global counter**. Each Ticket Type has its own **prefix**, so the displayed reference looks like `BUG-1047` or `PAY-1048`. The number is the identity and never changes (Q20, revised by the owner: option C). | Decided |
| 4.9a | When an Agent changes the Ticket Type, the number stays and only the prefix changes (`BUG-1048` becomes `PAY-1048`). Lookup uses only the number, so every old reference still opens the ticket in search, links and the API. A prefix for each type with its own counter (`BUG-12`) was rejected, because a type change would break references or leave a wrong prefix. | Decided |
| 4.9b | A prefix is 2–5 letters, and lowercase is changed to capitals automatically. It is suggested from the type name (`Access request` gives `ACC`) and can be edited. It must be unique across all types, including archived ones. A prefix that a type replaced stays reserved for that type, so an old reference never reads as a different type (changed in issue 08). | Delegated |
| 4.9c | The API and webhook payloads carry both `number` (integer, the identity) and `ref` (display, for example `PAY-1048`). Integrations must store `number`. | Delegated |
| 4.10 | Statuses are rows, and each has one fixed Status Category (open, active, waiting, done). v1 seeds `open`, `in_progress`, `waiting`, `resolved`, `closed`. Users cannot edit them in v1 (Q29). | Decided |
| 4.11 | Priority is a core attribute of every ticket: `low`, `normal`, `high`, `urgent`. Default `normal`. The Requester or the AI sets it at creation, and Agents can change it (Q38). | Decided |
| 4.12 | Branch (Australia, Singapore, ...) is a normal Field. No data residency, so one D1 database (Q16). | Decided |
| 4.13 | Each Ticket Type has exactly one owning Team. An Agent can be in more than one Team. A new install makes one Team, "Support", and new Agents join it (Q9, Q40). | Delegated |
| 4.14 | Assignment is manual (Q9). | Decided |
| 4.15 | Each Ticket Type has an icon and a color. The UI uses them in the sidebar, in lists and in the ticket header. | Delegated |
| 4.15a | Creating a Ticket Type is one page: name, "when to use it" (required), icon, color, Team, visibility, Fields. Nothing is saved until "Create", so no draft state exists. Creating makes Schema Version 1, and the type can be used at once. | Delegated |
| 4.15b | The icon is suggested from the name, and the color is the first one that no other type uses, archived types included. The icons and colors come from fixed lists (8 icons, 6 colors). When all colors are used, the first color is suggested. The Admin can change both (changed in issue 07). | Delegated |
| 4.15c | "When to use it" is required, because requesters see it and Claude uses it to choose the type. Each Field has help text, which Claude uses to ask for the value. | Delegated |
| 4.15d | A Field Key is generated from the label (`snake_case`). It can change until the type is created and is locked after that. A duplicate key is blocked when the Admin enters it. | Delegated |
| 4.15e | A name that an active type already uses is blocked, without regard to case. A name that an archived type uses links to "Restore" instead (changed in issue 07). | Delegated |
| 4.15f | Archiving a Ticket Type stops new tickets of that type. Old tickets keep it. The type can be restored. | Delegated |
| 4.16 | Validation is built from our own Field definitions. JSON Schema is output only (MCP tool schemas, OpenAPI). Reason: Ajv uses `eval`, and Workers do not allow it. | Delegated |
| 4.17 | Search: `LIKE` on title and description, plus filters. No FTS5, because it breaks `wrangler d1 export` backups (Q30). | Decided |
| 4.18 | Comments are Public or Internal. Agent comments are Internal by default (Q17). | Decided |
| 4.19 | An Application can add Public Comments for its Contact (Q17). The comment author is the Application. The UI and API show the Contact's name with the label "Contact · <Application>" (changed in issue 13). | Decided |
| 4.20 | A Requester can edit the description and Field values only while the Status Category is `open`. After that, the Requester can only add comments (Q39). | Delegated |
| 4.21 | A Requester can cancel a ticket at any time before `done`. It closes with the reason "cancelled by requester" (Q39). | Delegated |
| 4.22 | A Requester can reopen a `resolved` ticket within 14 days. After that, a new ticket is created and linked to the old one (Q39). | Delegated |
| 4.23 | An Application has the same Requester actions (4.20–4.22) for the tickets of its Contacts (Q39). It needs the `tickets:update` permission (changed in issue 13). | Delegated |
| 4.24 | An Admin can soft-delete a ticket. It is hidden everywhere and can be restored. No hard delete, except through Erasure (Q37). Admins see deleted tickets only in Settings › Privacy (changed in issue 22, see 4.40). | Decided |
| 4.25 | Revert works only on Status, Priority, assignee and Field value. It works only on the latest entry for that key, and only when the current value still equals the result of that entry. Else the answer is 409. A Revert is a new entry with the same permission as the original change. (issue 06) | Delegated |
| 4.26 | A Ticket Type change is not reversible, because the old Schema Version, the Team and the dropped values may have changed. To go back, change the type again. An entry that Erasure cleared is not reversible either. (issues 06, 08) | Delegated |
| 4.27 | A Requester who asks for an Internal Comment gets 403, not a silent change to Public. A comment sets the last update time of the ticket, so the queue shows new conversation. (issue 06) | Delegated |
| 4.28 | Agents and Admins change Field values through the ticket update call. Only the sent Fields are validated, so an old value that is no longer valid never blocks another edit. An empty value clears the Field. (issue 06) | Delegated |
| 4.29 | A Requester sees the Activity (events and Public Comments, with the names of who acted), but no Internal Comments and no Revert button. (issue 06) | Delegated |
| 4.30 | Each save of Fields sends the full Field list and the version the Admin edited. An older version answers 409. The server refuses a changed data type, a dropped Field or a dropped option. If the Fields did not change, no version is made. A change to the settings never makes a version. (issue 07) | Delegated |
| 4.31 | A select option is never removed or renamed. An Admin archives it and can restore it. (issue 07) | Delegated |
| 4.32 | The Team of a new Ticket Type is optional and defaults to the first Team. An unknown Team is refused. (issue 07) | Delegated |
| 4.33 | A Ticket Type change is refused for an unknown, an archived or the same target type. A required Field of the new type without a value is allowed and stays empty, because the ticket was made under the old rules. Status and assignee do not change. Team and visibility come from the new type. A file value keeps its attachment, also when the value does not move. (issue 08) | Delegated |
| 4.34 | A Requester cancel is recorded twice in one batch: an Activity entry, and a Public Comment "Ticket cancelled by requester." There is no free-text reason in v1. (issue 09) | Delegated |
| 4.35 | Only the Requester of the ticket (or the Application of the Contact) can cancel or reopen. An Agent who is not the Requester changes the Status instead. A `closed` ticket cannot be reopened. (issue 09) | Delegated |
| 4.36 | The 14 days of a reopen (4.22) count from the latest time the ticket became `resolved`. Exactly 14 days is inside. After that, the new ticket copies the type, Schema Version, title, description, priority and Fields, and points to the old ticket. The old ticket has no link forward. (issue 09) | Delegated |
| 4.37 | Search splits the text into words (at most 8). Each word must be in the title or the description. A word like `BUG-12` or `12` also finds the ticket with that number, whatever the prefix (4.9a). (issue 10) | Delegated |
| 4.38 | A filter on a Field value uses the Field Key, so it works across Schema Versions. The Branch filter shows only when some Ticket Type has a Field with the key `branch` (4.12). (issue 10) | Delegated |
| 4.39 | A Team has Agents or Admins as members. A User who becomes a Requester or is deactivated leaves all Teams. Team names are unique. A Team that owns any Ticket Type, archived ones too, cannot be removed. (issue 20) | Delegated |
| 4.40 | A deleted ticket is unreadable for every Principal, Admins included. Every action except restore answers "not found", and no Event, notice or email is written. Admins list deleted tickets only in Settings › Privacy. Delete and restore are Admin only, and each writes an Activity entry without values. (issue 22) | Delegated |
| 4.41 | The notices of a deleted ticket are hidden and come back on restore. Deliveries that were planned before the delete are still sent. The ticket counts of a Ticket Type and of an Application still count deleted tickets. (issue 22) | Delegated |

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
| 5.11 | A validation problem in an MCP tool is a tool result marked as an error, with a `problems` list, not a protocol error. A refusal by the policy is a tool result marked as an error too (changed in issue 11). `list_ticket_types` returns the type ID that `create_ticket` needs (issue 04). | Delegated |
| 5.12 | Text that Users wrote is wrapped in `<untrusted_content>` tags in tool results: title, description, Field values and comment bodies. A closing tag inside the text is broken, so the text cannot end the marker. Each such result has a `notice` that says the text is data. Names, emails, Status and Priority are not marked. (issue 11) | Delegated |
| 5.13 | `search_tickets` is open to every role, as the REST list is, because the query already limits a Requester to tickets they may read. Lists show 20 tickets by default and 50 at most. `get_ticket` sends the newest 20 comments. (issue 11) | Delegated |
| 5.14 | An Upload Link is used up by the upload, not by opening the page. The link is claimed before the body streams, and a failed upload gives it back. A Worker that stops during an upload leaves it used, which is the safe side. Refusals name the cause (not found, wrong User, used, expired), because the token has 256 bits and cannot be guessed. (issue 17) | Delegated |
| 5.15 | `attach_text` counts size in UTF-8 bytes. A larger text answers `FILE_TOO_LARGE` and points to the Upload Link tool. The caller cannot choose the type: `text/csv` for a `.csv` name, else `text/plain`. (issue 17) | Delegated |
| 5.16 | MCP acts only as a User. An Application cannot call MCP tools or use an Upload Link. (issues 12, 17) | Delegated |

## 6. REST API

| # | Decision | Status |
|---|---|---|
| 6.1 | Versioned path `/api/v1` (Q28). | Decided |
| 6.2 | The OpenAPI spec is generated from the same definitions that validate requests (Q28). | Decided |
| 6.3 | Create accepts an `Idempotency-Key` header. Keys are kept for 24 hours (Q28). | Decided |
| 6.4 | Cursor pagination. One error format: `{ error: { code, message, details } }` (Q28). | Decided |
| 6.5 | The cursor is the sort key of the last row, not an offset, so a new ticket between two requests does not shift the rows. The limit is 1 to 200, default 50. Counts cover all pages of the active filters. A bad cursor answers 422. (issue 10) | Delegated |
| 6.6 | `Idempotency-Key` is for Applications only. The same key with another body answers 409 `IDEMPOTENCY_KEY_REUSED`. A repeat answers 201 with the ticket as it is now, and the header `Idempotent-Replayed: true`. A failed create records no key. (issue 12) | Delegated |
| 6.7 | The OpenAPI document is public and is built at build time, because building it at runtime costs about 10 ms of CPU. It covers only the routes that Applications use. (issue 12) | Delegated |
| 6.8 | A body that is not JSON answers 400 `INVALID_JSON` in the standard error format. (issue 12) | Delegated |

## 7. Attachments

| # | Decision | Status |
|---|---|---|
| 7.1 | The R2 bucket is private. Each download goes through the Worker, with the same access check as the ticket (Q22). | Decided |
| 7.2 | Files are served with `Content-Disposition: attachment` (Q22). | Decided |
| 7.3 | Applications and the web UI upload with a raw streamed `PUT /api/v1/tickets/{id}/attachments`, with the filename in a header. No multipart, because parsing it uses CPU (Q27). | Decided |
| 7.4 | Maximum file size is 25 MB. Uploads must send `Content-Length`, because R2 needs to know the length. | Delegated |
| 7.5 | No malware scanning in v1 (Q22). | Decided |
| 7.6 | A file that a User uploads before the ticket exists is unattached. Only the uploader can read it. A "file" Field on a new ticket can claim it. A file of another person, or a file already on a ticket, gives the same Field error as an unknown file. (issue 16) | Delegated |
| 7.7 | Only images (PNG, JPEG, GIF, WebP), PDF, plain text, CSV, JSON, ZIP and the three Office types are served with their own type. Everything else, HTML and SVG included, is served as `application/octet-stream`. All downloads also carry `nosniff`, a sandbox CSP and `no-store`. Reason: a stored file must never run script on our origin. (issue 16) | Delegated |
| 7.8 | Everyone who can read a ticket can attach a file to it, a Requester included. An Application can attach only to its own tickets, and it cannot make an unattached upload. (issues 12, 16) | Delegated |

## 8. Webhooks and notifications

| # | Decision | Status |
|---|---|---|
| 8.1 | Events: `ticket.created`, `ticket.updated` (with a `changed` list of Field Keys), `comment.created` (Q11). | Decided |
| 8.2 | Payload: the full ticket `before` and `after`, `actor`, and `event_id`. Fields use their Field Keys (Q11). | Decided |
| 8.3 | Delivery is at least once and signed with HMAC-SHA256, with retries and backoff. The admin UI shows a delivery log (Q11). | Decided |
| 8.4 | Outbox: the ticket change and its Event are written in the same D1 `batch()`, so no Event is lost. A Cron Trigger or a Queue then delivers it (Q11). | Decided |
| 8.5 | Admin Webhook Endpoints get all Events. Internal data goes only to endpoints marked "internal" (Q11). | Decided |
| 8.6 | An Application Webhook Endpoint gets only the Events for that Application's tickets, and only Public Comments (Q18). The payload shows staff as in 3.11: "Support", with no name and no email (changed in issues 13, 15). | Decided |
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
| 8.16 | The Event payload is built by D1 in the same batch as the change: `before` is read before the update and `after` after it. The final JSON text is stored, signed and sent as it is, so a retry sends the same bytes. Reason: exact snapshots at no Worker CPU (2.6). (issue 14) | Delegated |
| 8.17 | Signing follows Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`), so receivers can use a standard library. Rotation stops the old secret at once. (issue 14) | Delegated |
| 8.18 | A signing secret is stored encrypted (AES-256-GCM) with a key derived from `BETTER_AUTH_SECRET`, because the Worker must read it to sign. A copy of the database alone does not give the secrets. If `BETTER_AUTH_SECRET` changes, rotate every secret. (issue 14) | Delegated |
| 8.19 | A Cron Trigger every minute delivers Events and purges old rows (9.3). Each run sends at most 3 rounds of 10 deliveries, each with a 10 s timeout. A delivery is made at the time of the change for each endpoint that is on, so an endpoint added later does not get older Events. (issue 14) | Delegated |
| 8.20 | Retries wait 1 min, 5 min, 15 min, 1 h, 3 h, then 6 h. No retry is planned later than 24 hours after the Event (8.7). A success is any 2xx. A redirect is a failure. (issue 14) | Delegated |
| 8.21 | The 3 days of 8.7 count from the first failed attempt since the last success. Turning the endpoint on again clears the failure state. An endpoint that an Admin turned off keeps its pending deliveries. (issue 14) | Delegated |
| 8.22 | Only an Event that carries an Internal Comment is internal. No Field value is internal, because Fields have no permissions (3.6). (issue 14) | Delegated |
| 8.23 | A webhook URL must be `https` (`localhost` is allowed only in development). Private and internal names and address ranges are refused. A Worker cannot see the address that a name resolves to, so a public name that points to a private address passes. Cloudflare's outbound network has no route to the owner's private network, and redirects are not followed. (issue 14) | Delegated |
| 8.24 | The Application Webhook Endpoint cannot be widened: the API accepts only the three fixed events and `include_internal` false. The filter is in the fan-out query and ignores stored values. Disabling an Application does not stop its webhook. (issue 15) | Delegated |
| 8.25 | The Inbox keeps one row for each recipient. The text of a notice is built when it is read, so a comment excerpt follows Erasure. A notice is never made for the actor of the change. "Ticket created" goes to the staff of the Team that owns the Ticket Type. (issue 18) | Delegated |
| 8.26 | Email preferences are stored only after a change. The defaults are all on, except Internal Comments. The switches depend on the role. A Requester also has a switch for "Status of my ticket changes". (issue 18) | Delegated |
| 8.27 | A Contact gets no Inbox notice and no email. A notice about a Contact's ticket without an actor names the source Application. (issues 12, 19) | Delegated |
| 8.28 | Email is queued after the change succeeded, with `waitUntil`, for REST and MCP. A failure never affects the change. A notice is mailed once, and a failed email is not retried. A Requester never gets an email for an Internal Comment, and deactivated Users get none. (issue 19) | Delegated |
| 8.29 | The Inbox and the email share one text. The subject is `[GEN-12] <text>` on one line. The email has a plain text part and a small HTML part that escapes all ticket text. There is no template engine. (issue 19) | Delegated |
| 8.30 | A mail error is logged and shown to Admins in Settings with the time, until the next send works. It makes no Inbox notice, because a daily-limit error would repeat for every email. "Send test email" goes to the Admin's own address. (issue 19) | Delegated |
| 8.31 | Admin Webhook Endpoints get no Event for a Restricted ticket (3.32), unless the endpoint has "include internal data". Otherwise its title would reach a team channel. Notices of a Restricted ticket go to its Participants only. (issue 27) | Decided |

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
| 9.5 | The audit log keeps facts in their own columns. Personal values are only in `before` and `after`. A written value is never SQL NULL, so NULL means erased. Erasure sets both to NULL and keeps the row. Comment bodies are not in the log, and Erasure clears the comment instead. (issue 06) | Delegated |
| 9.6 | Each change writes its audit entry in the same batch as the change. An entry has exactly one Principal: a User or an Application. An entry has either a ticket or a subject (Ticket Type, User, invite, Team). (issues 06, 12) | Delegated |
| 9.7 | Erasure is for Contacts only. An internal User is deactivated, not erased, because the User has an account and an audit trail as staff. (issue 22) | Delegated |
| 9.8 | An Admin, or the Application that owns the Contact, can erase a Contact. The Application needs no special permission, because a data request is its right. Another Application gets 404, and another User gets 403. (issue 22) | Delegated |
| 9.9 | Erasure also replaces the external ID (`[erased]:<id>`), so a later ticket with the old ID makes a new Contact. It deletes the Contact's Upload Links, Idempotency-Key rows, notices and outbox Events with their deliveries, and it writes one `ticket_erased` entry for each ticket. The tickets and their numbers stay. Deleted tickets are erased too. (issue 22) | Delegated |
| 9.10 | Erasure changes D1 first, then R2. The batch marks the files as erased, and downloads refuse an erased file, so a file left in R2 after a failure is unreachable. Erasure is safe to run again. (issue 22) | Delegated |
| 9.11 | Erasure sends no Event, because receivers already have the old payloads. An email that was sent cannot be recalled. (issue 22) | Delegated |

## 10. Security limits

Rate limits (Q41, Delegated). An Admin can change the limits for each Application (changed in issue 23, see 10.3).

| Who | Limit |
|---|---|
| Application (all its keys) | 60 requests/min, of which 10 creates/min |
| User (web) | 120 requests/min |
| User through MCP | 30 tool calls/min, of which 10 writes/min |
| Sign-in endpoints, for each IP | 10/min |
| Email OTP, for each email address | 5/hour |

Before implementation, confirm that the Cloudflare rate-limiting binding is available on the Free plan. If it is not, use a counter in D1 for the sign-in and OTP limits only.

| # | Decision | Status |
|---|---|---|
| 10.1 | Binding check (2026-10-18, https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). The page documents `ratelimits` in the Wrangler config and `env.X.limit({ key })`. `period` must be 10 or 60 seconds. Limits are per Cloudflare location, so counts are approximate. The page and the Workers limits page (https://developers.cloudflare.com/workers/platform/limits/) do not say that the Workers Free plan includes it, and do not say that `wrangler dev` or `@cloudflare/vitest-plugin` support it. | Decided |
| 10.2 | Because of 10.1, and because the limit of a binding is fixed in config while Admins change the limit for each Application, all limits use one D1 fixed-window counter: table `rate_counter (key, window, count)`, one UPSERT with `RETURNING` for each counted request. It is exact, works in tests and local dev, and refuses visibly. Cost: one D1 row write for each counted request. At the scale of 1.3 this is far below the Free plan write budget. Fixed windows allow up to 2 times the limit across a minute boundary. The cron deletes counters older than 2 minutes. | Decided |
| 10.3 | The API key limits are set for each Application (the Rate limit row on the Application page, as in the canvas), not for each key. They are counted for the Application, so all its keys share them and a new key does not give more room. Defaults 60 requests/min and 10 creates/min (`POST /api/v1/tickets`). Creates also count as requests. The create limit cannot be above the request limit. | Decided |
| 10.4 | Where the limits apply: REST after the key or session is verified (so bad keys cost no D1 write); each MCP tool call, with writes (every tool without `readOnlyHint: true`) also counted in the 10/min write limit; `POST /api/auth/sign-in/*` and `/api/auth/email-otp/*` for each `CF-Connecting-IP` (without the header, as in local dev, all callers share one counter). REST answers 429 `RATE_LIMITED` in the standard error format with `Retry-After`; MCP answers a tool error `RATE_LIMITED: ...`; the Better-Auth routes answer 429 `{ code, message }` with `Retry-After`. The per-address code limit of ADR 0001 is unchanged. | Decided |
| 10.5 | Test override: `RATE_LIMITS=off` turns the limits off. The config check refuses it unless `APP_ENV` is `development` or `test`, so staging and production fail at start. Playwright sets it with `--var`. Vitest keeps the limits on: tests use a new random `CF-Connecting-IP` for each call, and the limit tests wait for a fresh minute. | Decided |

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
| 12.3d | The organization name, subtitle and logo can be read without a session, because the sign-in page shows them. Only Admins change them (issue 21). | Delegated |
| 12.3e | Until R2 is bound, the logo is stored in D1 (at most 1 MB, PNG signature checked) and served with `nosniff` and a sandbox CSP (issue 21). | Delegated |
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
| 13.7 | Similar tickets: at most 5 open tickets that the User can read. A ticket matches when its title has at least 2 of the words of 3 letters or more from the typed title. The form waits 400 ms, ignores late answers, and hides the box when the request fails. (issue 10) | Delegated |

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
| 14.7 | Archiving a Ticket Type has an "Undo" in the toast and no confirm dialog. The editor has a "Details" card for the name, description and icon. "Types and fields" is one flat item in the Admin part of the sidebar. The order of Fields is the order of creation, with no drag handle. (issue 07) | Delegated |
| 14.8 | "Change type" opens an inline select with a note, not a modal. (issue 08) | Delegated |
| 14.9 | The list shows every Status group. Pages come in Status order, so a later group can show a count and "N more below". "Load more" is under the last group. Search and filters are in the address, so a filtered list can be shared. (issue 10) | Delegated |
| 14.10 | The UI shows an Application's action as the Contact's name with a chip "Contact · <Application>", and "(via API)" in the Activity. (issue 13) | Delegated |
| 14.11 | An API key gets a name in a small dialog. Permissions and allowed types save at once, with a toast. (issue 12) | Delegated |

## 15. Not in v1

Workflows (custom Statuses, transitions, rules-based routing, for example by branch), SLAs, automations, reporting, watchers, Kanban view, Calendar view (tickets have no dates yet), direct messages, malware scanning, full-text search, OAuth client credentials, more mail providers, binary file transfer from the AI, LLM features in the web form, deleting an Attachment, a limit on the files of one ticket, range requests on downloads.

Kanban is the first view to add after v1. Status changes already go through one API, so a Kanban view is only a UI addition.

## 16. Open questions

The owner must answer these. The cloud setup is deferred, so several checks wait for it.

- Cloud setup (issue 01, steps 1–6): the Workers Paid account, the sending domain, the staging D1 and R2, the CI token and secrets. Until then, these are not checked: a real code email on staging, the claude.ai connector (issues 01, 04, 11), a real notification email (issue 19), and the Cron Trigger on a deployed Worker (issue 14).
- CPU budget (2.6): issue 02 is deferred, so no route has a measured CPU time. This includes the 25 MB upload (issue 16), the Activity route (issue 06), the delivery run (issue 14), and the D1 write of each rate-limited request (issue 23).
- A ticket created for a very large Team sends emails in parallel. This could pass the 50 subrequest limit of the Free plan (issue 19). Batch the sends only if it happens?
- A webhook URL check cannot see the address that a public name resolves to (8.23). Is the platform protection enough (issue 14)?
- Erasure of an internal User is not built (9.7). Does the owner need it (issue 22)?
- Does an Application need a `contact.erased` Event? Today none is sent (issue 22).
- Unattached uploads and used Upload Links stay forever (issues 16, 17, 22). Add a cleanup before production (issue 24)?
- A Team owns Ticket Types but does not filter the queue of its Agents (issue 20). Should it?
- Production baseline (issue 24) and SSO sign-in (issue 25) are deferred. A public release needs SSO (3.2b).
- Playwright flows for issues 05 and 21 were done by hand. Many screens in issues 06–23 were not seen in light mode, dark mode or at 375 px (see their "Not verified" sections).
