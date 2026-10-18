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

`data` and the message fields are defined in the developer guide, [docs/ticket-apps.md](../ticket-apps.md#the-context). That guide is the contract: build to it, and change it in the same commit if the build must differ. In short: `version`, `app`, `theme`, `agent`, `ticket` (the REST field names and shapes), `requester`, and `expires_at` next to the token. No comments, no attachments, no Participants.

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

- [ ] Test: Admin CRUD of Ticket Apps; Agent and Requester get 403; an `http://` URL outside development gets 422; every change is in the Admin audit log.
- [ ] Test: the token route gives a token to an Agent who can read the ticket. It gives 404 for an unreadable ticket (the read rule), 403 for a Requester, 404 for an app that is off or not shown on this Ticket Type, and 401 without a session. An API key gets 403, because the route is session only.
- [ ] Test: the token checks against `/api/auth/jwks` with the right `aud`, `sub`, `tikki_ticket` and `exp`. The same token gets 401 at `/mcp`.
- [ ] Test: a Restricted ticket gives a token only to its Participants and Admins (the read rule; no extra code).
- [ ] Playwright: a test app served from another port gets `tikki:context` with the ticket ref. A message from another origin is ignored. `tikki:resize` changes the sidebar card height, within the limits.
- [ ] Playwright: a `tab` app loads only when its tab opens. An app on a chosen Ticket Type does not show on other types.
- [ ] Playwright: a Requester sees no apps on their own ticket.
- [ ] The layout spec passes with one sidebar app and one tab app (375, 1100, 1280, 1440 px, light and dark).

## Blocked by

- [33 · Ticket page tabs](33-ticket-page-tabs.md) (for the `tab` position)
- [32 · No framing of Tikki by other sites](32-frame-protection.md) (so the header work is done once and does not block app frames)
