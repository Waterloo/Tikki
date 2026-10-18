# 34 · Ticket Apps: an external page inside the ticket

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner request, 2026-10-18, after Chatwoot "Dashboard Apps". Design: [ADR 0004](../adr/0004-ticket-apps-and-context-tokens.md).

## What to build

An Admin adds a **Ticket App**: an external web page that Agents see inside the ticket. Example: an orders page that shows the customer's orders next to a payment ticket, so the Agent does not open a second tool.

This issue is read-only. The app gets the ticket context and a signed token that proves it. Writes come in issue 35.

### Admin page

- New page "Ticket Apps" in the admin navigation (Admins only).
- Each app has:
  - **name** (shown on the tab or card),
  - **URL** (HTTPS; `http://localhost` only when `APP_ENV` is `development` or `test`),
  - **position**: `sidebar` or `tab`,
  - **show on**: two choices. "All Ticket Types" (default) also covers types added later. "Only these types" opens a checklist of the Ticket Types, for example "Data request" and "Payment issue". With "Only these types", at least one type must be checked (422 otherwise). A type that is later archived or deleted just drops out of the list,
  - **order**: the list order on the admin page, changed with up and down buttons,
  - **on / off**.
- Create, change, turn off and delete are Admin audit entries (`adminAuditEntry`, subject `ticket_app`).
- The page shows a short "How to build an app" box with the `postMessage` names and a link to the docs section.

### On the ticket page

- Only Agents and Admins see Ticket Apps. Requesters never get the apps or a context token.
- **Sidebar position:** a card below Requester, with the app name as its title, and a collapse button. The iframe starts at 200 px. The app can set its height from 120 to 600 px with `tikki:resize`. It loads when the ticket opens.
- **Tab position:** one tab after Conversation and Activity (issue 33), named after the app. The iframe fills the main column. It loads the first time the Agent opens the tab.
- The iframe has `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"` and `referrerpolicy="no-referrer"`. No `allow-top-navigation`: an app cannot take over the Tikki tab.
- When an app does not load in 10 seconds, the card or tab shows "The app did not answer" with a Retry button. The rest of the page is not affected.

### Messages between Tikki and the app

Tikki sends every message only to the origin of the app URL (never `'*'`). Tikki acts only on messages whose `event.source` is that iframe's window and whose `event.origin` is the app's origin. All other messages are ignored.

| From | Message | Effect |
|---|---|---|
| app | `{ type: 'tikki:fetch-context' }` | Tikki answers with `tikki:context` |
| Tikki | `{ type: 'tikki:context', data, token }` | Sent when the iframe loads, on `tikki:fetch-context`, and after the ticket changes |
| app | `{ type: 'tikki:resize', height }` | Sidebar only. Clamped to 120–600 px |

`data` and the message fields are defined in the developer guide, [docs/ticket-apps.md](../ticket-apps-reference.md#the-context). That guide is the contract: build to it, and change it in the same commit if the build must differ. In short: `version`, `app`, `theme`, `agent`, `ticket` (the REST field names and shapes), `requester`, and `expires_at` next to the token. No comments, no attachments, no Participants.

### Context token

- A JWT signed with Tikki's existing keys (the JWKS at `/api/auth/jwks`).
- Claims:
  - `iss` is `{APP_URL}/api/auth`.
  - `aud` is the app's origin.
  - `sub` is the Agent's User id.
  - `tikki_app` is the app id.
  - `tikki_ticket` is the ticket ref.
  - `tikki_scope` is `read` (issue 35 adds more scopes).
  - `exp` is 5 minutes after the time it is made.
- Made by a new route `POST /api/v1/tickets/{ref}/apps/{appId}/token`, session only. The route checks four things: the app is on, the app is shown on this Ticket Type, the User is an Agent or Admin, and the User can read the ticket. It is not an Admin audit entry; it records nothing.
- The app's backend checks the token against the JWKS. The docs show how, with `jose` in about 10 lines.
- **Token confusion:** the MCP endpoint and every other verifier must refuse a context token. The MCP verifier already requires the MCP audience; add a test that proves a context token gets 401 at `/mcp`.

### Docs

[docs/ticket-apps.md](../ticket-apps.md) exists. Remove its "Status: planned" note when this issue and issue 35 are merged. Add a link to it from the README, and from the admin page's "How to build an app" box.

## Acceptance criteria

- [x] Test: Admin CRUD of Ticket Apps; Agent and Requester get 403; an `http://` URL outside development gets 422; every change is in the Admin audit log.
  Evidence: `test/worker/ticket-apps.test.ts` "Ticket Apps: admin": create, change, turn off, move, delete, each with its audit entry by the Admin; Agent and Requester get 403 on every admin route; `http://orders.example.com` gets 422; `appUrlProblem` refuses `http://localhost` for `staging` and `production`. `e2e/ticket-apps.spec.ts` drives the admin page.
- [x] Test: the token route gives a token to an Agent who can read the ticket. It gives 404 for an unreadable ticket (the read rule), 403 for a Requester, 404 for an app that is off or not shown on this Ticket Type, and 401 without a session. An API key gets 403, because the route is session only.
  Evidence: `test/worker/ticket-apps.test.ts` "Ticket Apps: the token route". Also: a deleted app gets 404, and the route writes no audit row.
- [x] Test: the token checks against `/api/auth/jwks` with the right `aud`, `sub`, `tikki_ticket` and `exp`. The same token gets 401 at `/mcp`.
  Evidence: `test/worker/ticket-apps.test.ts`: `jwtVerify` with the JWKS, issuer and the app origin; another audience fails. `/mcp` answers 401 to the context token and 200 to an MCP token. `/api/auth/oauth2/userinfo` and the REST API also answer 401.
- [x] Test: a Restricted ticket gives a token only to its Participants and Admins (the read rule; no extra code).
  Evidence: `test/worker/ticket-apps.test.ts`: assignee, added Participant and Admin get 200; another Agent gets 404.
- [x] Playwright: a test app served from another port gets `tikki:context` with the ticket ref. A message from another origin is ignored. `tikki:resize` changes the sidebar card height, within the limits.
  Evidence: `e2e/ticket-apps.spec.ts`: the app on port E2E_PORT+100 gets the context (ref, theme, token claims). Resize 50, 5000, 260 gives 120, 600, 260. A page from `127.0.0.1` in the same frame sends `tikki:resize` and `tikki:fetch-context`: the height stays, and it gets no context. A Priority change sends a new context. A silent app shows "The app did not answer" and Retry.
- [x] Playwright: a `tab` app loads only when its tab opens. An app on a chosen Ticket Type does not show on other types.
  Evidence: `e2e/ticket-apps.spec.ts`: no request to the tab app until the tab is clicked, then one request; a tab switch does not reload it. A Bug-only app shows on a Bug ticket and not on a General request ticket.
- [x] Playwright: a Requester sees no apps on their own ticket.
  Evidence: `e2e/ticket-apps.spec.ts`: no iframe, no app tab, no request to `/apps` or to the app; the token route answers 403.
- [x] The layout spec passes with one sidebar app and one tab app (375, 1100, 1280, 1440 px, light and dark).
  Evidence: `e2e/layout.spec.ts` seeds one sidebar app and one tab app on the Bug ticket, and checks "Ticket", "Ticket, app tab" and "Ticket Apps".

## Blocked by

- [33 · Ticket page tabs](33-ticket-page-tabs.md) (for the `tab` position)
- [32 · No framing of Tikki by other sites](32-frame-protection.md) (so the header work is done once and does not block app frames)

## Not verified

- The 10 s timeout and Retry are tested with an app that never posts. A page that never loads (a hanging server) is not tested; it gives the same result, because only a message counts.
- The sandbox is checked by its attribute value, not by a test that tries `top.location` from the app.
- Popups: with `allow-popups-to-escape-sandbox` (the spec's flags), a popup of the app has no sandbox and keeps `opener`. It can probably navigate the Tikki tab through `opener.top`. Not tried in a browser. The guide now says only the frame cannot navigate the tab.

## Decisions made here

- **No `access` column yet.** Issue 35 adds `access text NOT NULL DEFAULT 'read'` with a plain `ALTER TABLE ADD`; SQLite needs no table rebuild for that. The token always has `tikki_scope: 'read'` (`SCOPE` in `server/utils/ticket-apps.ts`).
- **"Show on" is a JSON column** `ticket_app.ticket_type_ids`: `NULL` is all types, else a list of at least one type (422 for `[]`). Same form as `application.ticket_type_ids`. An archived type drops out both from the admin list and from the match on the ticket, so the Admin sees what applies. An app whose chosen types are all archived shows on no ticket; the admin page says so.
- **The app URL cannot be on Tikki's own origin** (422). With `allow-scripts allow-same-origin`, a same-origin frame can remove its own sandbox.
- **The server builds the context.** `POST /api/v1/tickets/{ref}/apps/{appId}/token` answers `{ token, expires_at, data }`. `data` is the guide's context without `theme`; the browser adds `theme`. The route reads the ticket with `getTicket` (the read rule), so the context and the token come from one check.
- **The route is session only, and any `Authorization` header gets 403**, also with a cookie. So in issue 35 a context token or API key can never mint a new token.
- **The Agent or Admin check is `authorizeTicketApps` in `policy.ts`.** `GET /api/v1/tickets/{ref}/apps` lists the apps of a ticket, with the same checks.
- **"Loaded" means the app sent its first message** within 10 s. A frame `load` event also fires for a browser error page, so it proves nothing. The guide says so (Messages, Errors).
- **The page caches the token** and sends the cached one while more than 60 s are left. The renew time comes from the token's own lifetime (`exp - iat`) and the local time of receipt, so a wrong clock on the Agent's computer does not give the app an expired token. So an app that sends `tikki:fetch-context` often does not use up the Agent's web rate limit. A ticket change or a type change gets a new token.
- **The context is sent again when the color mode changes**, with the cached token.
- **"After the ticket changes" means a change on this page** (the Agent's own edit or revert). A change by another person does not send a new context; the page has no live updates. The guide says so.
- **`GET /api/v1/tickets/{ref}/apps` also refuses any `Authorization` header** (403), like the token route.
- **The admin form sends `ticket_type_ids` only when it changed**, so an app whose types are all archived can still be renamed.
- **Order**: `sort_order`, with `POST /api/v1/admin/ticket-apps/{id}/move` `{ direction }`. It swaps with the neighbour in one batch and writes `ticket_app_moved` on the moved app.
- **Audit actions**: `ticket_app_created`, `ticket_app_changed` (changed keys only, before and after), `ticket_app_enabled`, `ticket_app_disabled`, `ticket_app_moved`, `ticket_app_deleted`. Subject type `ticket_app`.
- **Admin routes** are under `/api/v1/admin/ticket-apps`. The page is `/admin/apps`, nav item "Ticket Apps" after Webhooks.
- **The guide is served** at `/api/docs/ticket-apps.md` (plain text, read at build time with a Nitro virtual module, like the OpenAPI document). The repository has no public URL, so the admin page links there. It is under `/api` because only those paths run the Worker.
- **`test/worker/migrations.test.ts`**: the final "no empty table" guard now skips tables that the last migration made, because nothing seeds them after it. Without this, any issue whose migration is last and adds a table fails.
- The test app for Playwright is `e2e/ticket-app-server.mjs`, a second `webServer` on `E2E_APP_PORT` (default `E2E_PORT + 100`).

## Notes for later issues

- Issue 35: add the `access` column and its setting on the admin page, `tikki:refresh` in `TicketAppFrame.vue`, and the Bearer context token in `restPrincipal`. Keep the token route refusing every `Authorization` header. Check the app (on, shown on the type) on each API call.
- Issue 35: the guide's "Status: planned" note is still there.
- Popup `opener` (see Not verified): if it is real, `Cross-Origin-Opener-Policy` on the SPA pages (issue 32's `_headers`) would remove `opener` from cross-origin popups. Check the sign-in flows first.
- `E2E_APP_PORT` (default `E2E_PORT + 100`) is a third port for each agent. `docs/agents/parallel-work.md` now says so.
- `ticket_app` holds no personal data, so `eraseContact` needs no change. The privacy scan test passes.

## Glossary terms to add

- **Ticket App**: an external web page that Agents and Admins see inside a ticket, as a sidebar card or a tab. An Admin adds it.
- **Context token**: a JWT that Tikki signs for one Ticket App, one Agent and one ticket. It lives 5 minutes. Its audience is the app's origin.
