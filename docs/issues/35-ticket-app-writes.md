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

- [ ] Test: a `read` token can GET the ticket, comments and activity, and gets 403 on POST comment and PATCH.
- [ ] Test: a `comment` token can add a comment, and gets 403 on PATCH. An `update` token can change Status, and gets 403 on type change, cancel and revert.
- [ ] Test: any token gets 404 on another ticket, and 403 on `GET /tickets`, search, `/users`, `/applications` and `/ticket-types` writes.
- [ ] Test: the token gets 401 after it expires, after its app is turned off or deleted, and after the Agent is deactivated or becomes a Requester. It gets 404 after the Agent loses read access (a Restricted ticket without them as a Participant).
- [ ] Test: a write by token has an audit entry with `channel: 'app'`, `principal_id` = the Agent and `ticket_app_id` = the app. It also has an Event and notices, like a web write.
- [ ] Test: a context token gets 401 at `/mcp`, and an MCP token gets 401 as a context token.
- [ ] Playwright: the test app adds an internal note with its token and sends `tikki:refresh`. The note appears in Conversation with "via <app name>".
- [ ] The docs show a write example (comment and Status change) and the scope table.

## Blocked by

- [34 · Ticket Apps](34-ticket-apps.md)
