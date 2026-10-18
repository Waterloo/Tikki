# 39 · App pages: an Apps menu in the main sidebar

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner request, 2026-10-18, after the Jira "Apps" menu. Design: [ADR 0005](../adr/0005-ticket-app-placements-pages-manifest.md).

## What to build

A Ticket App with a `page_url` (issue 37) gets a full page in Tikki, outside any ticket. Example: a timesheet with the time of every ticket, by ticket or by person.

### Navigation

- The main sidebar gets an **Apps** section after the existing items: one entry for each app with a page that the User may see, with its icon (issue 38) and name, in the admin order. No section when there are none.
- `/apps/{id}` shows the page: the app's name as the page title, and the iframe fills the main area (full height under the header, no card). At 375 px it fills the screen width.
- The frame URL gets `?placement=page`. Same sandbox and `referrerpolicy` as the other placements, and no `allow` attribute.

### Who sees it

- Default: Agents and Admins.
- New app setting **"Show the page to Requesters"** (off by default; audited). It applies only to the page. Sidebar and tab stay staff only.
- Anyone else gets the not-found page for `/apps/{id}`, and the API answers 404.

### Page context and token

- Context (`tikki:context`): `version`, `app` (`id`, `name`, `placement: 'page'`), `theme`, `user` (`id`, `name`, `email`, `role`). No `ticket`, no `requester`. The guide shows both shapes.
- Token from `POST /api/v1/apps/{id}/token` (session only; any `Authorization` header gets 403, as in issue 34). Claims: `iss`, `aud` (the page URL's origin), `sub`, `tikki_app`, `tikki_placement: 'page'`, `tikki_role`, `exp` (5 minutes). **No `tikki_ticket` and no `tikki_scope`.**
- **The page token proves who the User is, and nothing more.** `principalForContextToken` refuses a token without `tikki_ticket` (401), so it cannot read or write any ticket through the REST API. The app's backend uses `sub` and `tikki_role` for its own rules.
- The role in the token is the role at the time the token was made (5 minutes at most).

### Navigation from the app

- New message from the app: `{ type: 'tikki:navigate', path }`. Tikki accepts only a path that starts with `/tickets/` or `/apps/` and has no scheme, no `//`, and no backslash. It navigates in the SPA. Any other path is ignored.
- It works from every placement, so a sidebar app can also link to another ticket.
- The guide adds it to the message table.

### Admin

- The app list shows "Page" and "Requesters" chips. The admin form gets the "Show the page to Requesters" switch, enabled only when a page URL is set.

## Acceptance criteria

- [ ] Test: the token route gives a page token to an Agent and an Admin; to a Requester only when the app shows its page to Requesters; 404 for an app without a page URL or turned off; 403 with any `Authorization` header.
- [ ] Test: the page token has `tikki_role` and no `tikki_ticket`; it gets 401 on `GET /api/v1/tickets/{ref}`, on the comment route, and at `/mcp`.
- [ ] Test: `GET /api/v1/apps` (the list for the menu) returns only the apps the User may see.
- [ ] Playwright: the Apps section lists a page app; `/apps/{id}` loads the test app with `placement=page` and a context without `ticket`.
- [ ] Playwright: `tikki:navigate` with `/tickets/{ref}` opens the ticket; `https://evil.test/`, `//evil.test` and `/sign-out` are ignored.
- [ ] Playwright: a Requester sees no Apps section until "Show the page to Requesters" is on, then sees only that app.
- [ ] The layout spec passes, with the app page at 375 px and desktop, light and dark.

## Blocked by

- [37 · One URL for each placement](37-ticket-app-placements.md)
