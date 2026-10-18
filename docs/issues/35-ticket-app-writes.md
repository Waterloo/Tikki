# 35 · Ticket Apps change the ticket through the API

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Design: [ADR 0004](../adr/0004-ticket-apps-and-context-tokens.md).

## What to build

A Ticket App can add a comment or change the ticket it is open on, for example "Refund issued" as an internal note with the Status set to Resolved. The app's backend calls the normal REST API with the context token. It acts as the Agent who has the ticket open, on that one ticket only. The audit shows the app.

### Scopes

- Each Ticket App gets **access**, set by the Admin:
  - `read` (default): what the app can do in issue 34, nothing more.
  - `comment`: also add Public and Internal Comments.
  - `update`: also change Status, Priority, assignee and Field values.
- `update` includes `comment`. A change of access is an Admin audit entry.
- The token's `tikki_scope` is the app's access at the time the token is made. Lowering the access stops new tokens; old tokens end within 5 minutes.

### The context token as a credential

- `restPrincipal` accepts `Authorization: Bearer <context token>`. It knows a context token by its form (a JWT, not `gt_live_...`).
- It checks the signature, `iss`, `exp`, and that `aud` is the origin of an app that is still on and whose id is `tikki_app`.
- It then loads the User in `sub`. A deactivated User, or one who is no longer an Agent or Admin, gets 401.
- It returns a `UserPrincipal` with `channel: 'app'` and `ticketAppId`, limited to one ticket and one scope.
- **One-ticket rule:** the limit lives in `policy.ts`, not in each route. Any ticket other than `tikki_ticket` is NOT_FOUND. Any action outside the scope is FORBIDDEN. Lists, search, the admin routes and the people routes refuse the token (403).
- The Agent's own rights still apply through the read rule. If the Agent can no longer see the ticket, the token cannot either.
- Routes the token can use:
  - `GET /tickets/{ref}`,
  - `GET /tickets/{ref}/comments`,
  - `GET /tickets/{ref}/activity`,
  - `POST /tickets/{ref}/comments` (comment),
  - `PATCH /tickets/{ref}` (update; Status, Priority, assignee, Fields only).
- Not type change, Team move, Participants, cancel, delete or revert. Those stay in the Tikki UI.
- Writes go through `applyChange` as today, so the audit entry, the Event, the notices and the mail come for free.
- Rate limit: the Agent's web limit (`user:{id}`), so an app cannot exceed what the Agent could do by hand.
- CORS: none. Only the app's backend calls the API, so the browser cannot use the token from another site.

### Channel and Activity

- `Channel` gets the value `app`. The audit log records the app id in a new fact column, `ticket_app_id`.
- `channel` columns have no CHECK, so the migration adds only the new column. Run `pnpm lint:migrations`.
- Activity and comments show "Sam via Orders app", like "via Claude" today. If the app is deleted later, the entry shows "via a Ticket App".
- Webhook Events carry `channel: 'app'`. `applicationView` hides the app name, as it hides staff names.
- After a write the app sends `{ type: 'tikki:refresh' }`, and the ticket page reloads the ticket. Tikki also refreshes when it gets the change Event, if that comes first.

## Acceptance criteria

- [x] Test: a `read` token can GET the ticket, comments and activity, and gets 403 on POST comment and PATCH.
  Evidence: `test/worker/ticket-app-writes.test.ts` "scopes": three GETs answer 200, `allowed_actions` is empty, POST comment and PATCH answer 403 `FORBIDDEN`.
- [x] Test: a `comment` token can add a comment, and gets 403 on PATCH. An `update` token can change Status, and gets 403 on type change, cancel and revert.
  Evidence: same file. `comment`: an Internal and a Public Comment (201, `channel: 'app'`), PATCH 403. `update`: Status, Priority and assignee in one PATCH (200), a comment (201); type change, cancel, revert, Team move, description, delete 403; Participants 401 (session-only route).
- [x] Test: any token gets 404 on another ticket, and 403 on `GET /tickets`, search, `/users`, `/applications` and `/ticket-types` writes.
  Evidence: "one ticket only": GET, comments, POST comment and PATCH on another ticket answer 404 (an Admin's token). 403 for `/tickets`, `/tickets?q=`, `/tickets/similar`, `/tickets/deleted`, `/users`, `/applications`, `/assignees`, `/admin/ticket-apps`, `/ticket-types` (GET and POST), `POST /tickets`, attachments (GET and the PUT upload), `/apps` and the token route. `/notifications` and Participants answer 401: they read only the web session.
- [x] Test: the token gets 401 after it expires, after its app is turned off or deleted, and after the Agent is deactivated or becomes a Requester. It gets 404 after the Agent loses read access (a Restricted ticket without them as a Participant).
  Evidence: "when the token stops". The expired token is a real one, signed by `contextToken` with a time 6 minutes ago. Also: 401 when the app no longer shows on the ticket's type, and for a token with a changed payload.
- [x] Test: a write by token has an audit entry with `channel: 'app'`, `principal_id` = the Agent and `ticket_app_id` = the app. It also has an Event and notices, like a web write.
  Evidence: "what is recorded": `status_changed` and `comment_added` rows; `comment.ticket_app_id`; `ticket.updated` and `comment.created` Events whose `actor` has `channel: 'app'` and `ticket_app`; the Requester's `status_changed` and `public_comment` notices with the Agent as actor. Activity and comments answer `ticket_app: { id, name }`, and `null` after the app is deleted. An Application webhook delivery has `actor` and comment author `{ kind: 'support' }` and no app name; the Application's REST comments have `ticket_app: null`. The call counts in `user:{id}`.
- [x] Test: a context token gets 401 at `/mcp`, and an MCP token gets 401 as a context token.
  Evidence: "token confusion": the context token gets 401 at `/mcp` and `/api/auth/oauth2/userinfo`; an MCP access token gets 401 at GET ticket and POST comment.
- [x] Playwright: the test app adds an internal note with its token and sends `tikki:refresh`. The note appears in Conversation with "via <app name>".
  Evidence: `e2e/ticket-apps.spec.ts` "an app with comment access adds an internal note ...": the test app's backend (`/note` in `e2e/ticket-app-server.mjs`) calls the REST API with the token; the note shows with "Internal" and "via <name>" without a page reload. The first test also checks that the iframe has no `allow` attribute (no `tools` grant).
- [x] The docs show a write example (comment and Status change) and the scope table.
  Evidence: `docs/ticket-apps.md` "Change the ticket from your backend": scope table, curl for an internal note and for a Status change, the `actor` of the Event. The "Status: planned" note is removed.

## Blocked by

- [34 · Ticket Apps](34-ticket-apps.md)

## Not verified

- Tikki has no live updates, so "Tikki also refreshes when it gets the change Event" is not built. The page reloads on `tikki:refresh` only; another viewer sees the change on the next load.
- The 429 at the Agent's web limit is not tested end to end; the test checks that a token call counts in `user:{id}`.
- `e2e/self-service.spec.ts` failed in 2 of 3 full e2e runs (the Reopen button is still there after 5 s) and passed 4 of 4 runs alone. This issue does not change that flow; it looks like a timing flake under load.
- `revertible` in the Activity of a token with `update` access can be true, but the revert route refuses the token (403). A Ticket App does not show Activity buttons, so nothing uses it.

## Decisions made here

- **The access at use time is the lower of `tikki_scope` and the app's access now.** The app row is read on each call anyway, so a lowered access applies at once, not in 5 minutes. A raised access applies to new tokens only. The spec said "old tokens end within 5 minutes"; the guide now says the stricter rule.
- **A context token is told apart from an API key by its form**: three base64url parts with dots (`looksLikeJwt`). Any JWT, also an MCP access token, goes to `principalForContextToken` and gets 401 when it is not a valid context token.
- **Checks on each call** (`principalForContextToken` in `server/utils/ticket-apps.ts`): signature with Tikki's JWKS, `iss`, `exp`, `sub`, `aud`; claims `tikki_app`, `tikki_ticket`, `tikki_scope` of the right types; the app exists, is on, is shown on the ticket's current type, and its origin equals `aud`; the User is active and an Agent or Admin. Each failure is 401.
- **The Principal** is `UserPrincipal` with `channel: 'app'` and `ticketApp: { id, ticketNumber, access }`. `UserPrincipal` is now a union, so `channel: 'app'` always has a grant.
- **Rules in `policy.ts`:**
  - `canRead` answers false for any ticket but `ticketApp.ticketNumber` (NOT_FOUND). `readableTickets` adds the same condition. `PolicyTicket` gets `number`, from `policyFacts` (and the copy in `attachments.ts`).
  - `authorize` refuses an action outside the access level (`APP_ACTIONS`) with 403. `update` allows Status, Priority, assignee and Fields; never description, type, Team, Participants, cancel, reopen or delete.
  - `isAdmin`, `authorizeList`, `authorizeListAssignees`, `authorizeTicketApps`, `assertMayCreate`, `canSeeTicketType`, `authorizeAttach`, `authorizeUnattachedUpload` and unattached `authorizeAttachmentRead` refuse a token.
  - **Route allow-list** `isTicketAppRoute`: `restPrincipal` accepts a context token only on the five routes of the guide, else 403. So a new route is closed to Ticket Apps until it is added. It is in `policy.ts` with the other rules; `restPrincipal` calls it.
- **Routes that read only the web session** (`sessionPrincipal`: notifications, Participants, and others) ignore the Bearer token and answer 401. That is a refusal too; the guide says so.
- **`ticket_app_id` on `comment` too**, not only on `audit_log`. The comment list then needs one join, not a lookup of each comment's audit entry (no index on `audit_log.comment_id`). Neither column has a foreign key: the app may be deleted and the entry stays (append-only audit log). Both are facts, not personal data; the Erasure scan test passes unchanged.
- **API shape**: comments and Activity events get `ticket_app: { id, name } | null`. Null for an Application viewer (the app name is staff data, like staff names) and after the app is deleted; then `channel: 'app'` with `ticket_app: null` means "a Ticket App". The Event `actor` gets `ticket_app` only for `channel: 'app'`; `applicationView` already replaces a User actor with `support`.
- **UI text**: Activity shows "Sam Lee (via Orders)", like "(via Claude)". A comment shows the chip "via Orders" (icon `app-window`). The guide's "What people see" matches.
- **`tikki:refresh`** is new in `TicketAppFrame.vue` (34 did not handle it). The page reloads the ticket quietly (no loading state, so the frames stay) and bumps the timeline. At most one reload in 3 s, with a trailing one: the reloads count in the Agent's web limit, and any app (also `read`) can send the message in a loop. A 404 shows the not-found page.
- **One ticket-reference pattern**: `TICKET_REFERENCE` in `shared/ticket-type-rules.ts`, used by `parseTicketReference` and the route allow-list. `canBeAssignee`, `canJoinTeam` and the token check use `isStaffRole`.
- **Migration** `0024_issue_35_ticket_app_writes.sql`: three `ALTER TABLE ADD` (`audit_log.ticket_app_id`, `comment.ticket_app_id`, `ticket_app.access DEFAULT 'read'`). No rebuild. `CHANNELS` in `schema.ts` gets `app`; the `channel` columns have no CHECK.
- **Erasure**: the insert-select of `ticket_erased` names every `audit_log` column in order, so it gets the new column.
- **MCP**: no change. Its views do not show `channel`; a context token never reaches `/mcp`.
- **Admin page**: "Access" radio group (Read, Comment, Update) in the form, and an "<Level> access" chip on each app. A change is in `ticket_app_changed` with `access` before and after.

## Notes for later issues

- A new REST route for Ticket Apps must be added to `APP_ROUTES` in `policy.ts`, and its actions to `APP_ACTIONS`.
- Live updates (if they come) should also refresh the ticket page after an app's change.

## Glossary terms to add

- **Ticket App access**: what a Ticket App's backend may do with its context token: `read`, `comment` or `update`. Each level includes the one before. An Admin sets it.
