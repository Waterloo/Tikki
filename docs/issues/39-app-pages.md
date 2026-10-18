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

- [x] Test: the token route gives a page token to an Agent and an Admin; to a Requester only when the app shows its page to Requesters; 404 for an app without a page URL or turned off; 403 with any `Authorization` header.
- [x] Test: the page token has `tikki_role` and no `tikki_ticket`; it gets 401 on `GET /api/v1/tickets/{ref}`, on the comment route, and at `/mcp`.
- [x] Test: `GET /api/v1/apps` (the list for the menu) returns only the apps the User may see.
- [x] Playwright: the Apps section lists a page app; `/apps/{id}` loads the test app with `placement=page` and a context without `ticket`.
- [x] Playwright: `tikki:navigate` with `/tickets/{ref}` opens the ticket; `https://evil.test/`, `//evil.test` and `/sign-out` are ignored.
- [x] Playwright: a Requester sees no Apps section until "Show the page to Requesters" is on, then sees only that app.
- [x] The layout spec passes, with the app page at 375 px and desktop, light and dark.

### Evidence

- Token route: `test/worker/app-pages.test.ts` "gives a page token to an Agent and an Admin, and to a Requester only when …", "answers 404 for an app without a page URL, an app that is off, and an unknown app", "answers 403 to any Authorization header, also with a session cookie" (page token, `gt_live_x`, `Basic`; also on `GET /api/v1/apps`).
- Page token: same file, "names the page and the role, and has no ticket and no scope" (claims and the page context), "gets 401 on the ticket, on the comment routes, and at /mcp" (GET ticket, GET and POST comments, PATCH, `/mcp` tools/list), and "still gets 401 … with a ticket and a scope added" (re-signed with Tikki's key; a control with `tikki_placement: 'sidebar'` gets 200).
- Menu list: same file, "lists only the apps the User may see, in the admin order" (no page URL, off, staff only, for Requesters).
- Playwright: `e2e/app-pages.spec.ts`, three tests: the Apps section and `/apps/{id}` (sandbox, `referrerpolicy`, no `allow`, `placement=page`, context without `ticket` and `requester`, claims, the frame fills the main area); `tikki:navigate` from a page and from a sidebar card (`https://evil.test/`, `//evil.test`, `/sign-out`, `/tickets/%2e%2e/sign-out`, `/\evil.test` and a number are ignored); the Requester before and after the admin switch (the switch is off without a page URL, the "Requesters" chip, then one app in the menu; the staff page stays "No app page here", its token 404).
- Path rule: `test/unit/app-navigation.test.ts` (19 cases).
- Layout: `e2e/layout.spec.ts` seeds the app with a page URL and checks "App page" at 375, 1100, 1280 and 1440 px, light and dark. The seeded page app also puts the Apps menu on every other layout page.
- Seen in a browser on the dev server (8839, headless Chromium screenshots): the app page at 375 px and 1280 px, light and dark; the phone menu with the Apps section (dark); the admin list with the "Page" and "Requesters" chips; the edit dialog with the switch at 375 px; "No app page here"; a Requester's sidebar with only the page shown to Requesters. No horizontal scroll at 375 px.
- Runs: `pnpm test` 472 passed (43 files), in 2 runs after the last change; `pnpm typecheck` passes; `E2E_PORT=9839 pnpm e2e` 100 passed in 2 runs after the fix below.
- The first two full e2e runs failed in one test both times: `ticket-apps.spec.ts` "a Requester sees no apps …" counted every request with `/apps` in the URL, and the new menu list `/api/v1/apps` loads for every User. The test now counts only `/api/v1/tickets/{ref}/apps…` and the app origin.
- One early `pnpm test` run had 1 failure. Its output was not kept. It did not come again in 6 later runs (4 `vitest run`, 2 `pnpm test`). Cause not found; see Not verified.
- Reviewer (opus, `git diff integration...issue-39`): one finding, rule 14a (`Edit` without `exact: true`), fixed. Also done from its notes: a sidebar or tab frame without a ticket now fails visibly, and `docs/architecture.md` names the page token and `visibleAppPages`.

## Not verified

- The cause of the one failure in the first `pnpm test` run (see Evidence). It could be the dev server build that ran in the same worktree a few minutes before; that is a guess.
- A real Requester in a real browser window: the screens were seen in headless Chromium screenshots, not in a desktop browser.
- `/mcp` refuses the page token because its `aud` is not the MCP resource. `/mcp` does not look at `tikki_*` claims. A refusal of any token with `tikki_app` there would be a second guard; not added.

## Decisions made here

- **Column** `ticket_app.page_for_requesters integer NOT NULL DEFAULT 0`, a plain `ALTER TABLE ADD` (migration `0026_issue_39_app_pages.sql`). API name `page_for_requesters`, in the admin answers and in `ticket_app_changed` (before and after).
- **`page_for_requesters: true` without a page URL is 422** (key `page_for_requesters`), also on a PATCH that removes the page URL while it is on. Not a silent reset: who sees the page must not change without the Admin seeing it. The form sends false when the Page URL field is empty.
- **The rule is `visibleAppPages(principal)` in `policy.ts`**, a SQL condition like `readableTickets`: staff see every page, a Requester only one with the setting on, a context-token Principal none. `appPagesFor` and `pageToken` in `ticket-apps.ts` add "on, with a page URL".
- **Ticket Types do not apply to a page.** "Show on" is for the ticket placements; a page is outside any ticket.
- **Routes**: `GET /api/v1/apps` answers `{ data: [{ id, name, url }] }` (`url` is the page URL; no sidebar or tab URL, so a Requester never learns them). `POST /api/v1/apps/{id}/token` has no body and answers `{ token, expires_at, data }`. Both are session only; any `Authorization` header gets 403. An app the User may not see is 404, like a missing one.
- **Page token** claims: `iss`, `aud`, `sub`, `tikki_app`, `tikki_placement: 'page'`, `tikki_role`, `iat`, `exp`. `tikki_role` and `user` come from the user row when the token is made. `principalForContextToken` is unchanged: it needs `sidebar` or `tab`, `tikki_ticket` and `tikki_scope`, so it refuses a page token.
- **Page context** key is `user`, not `agent` (a Requester can see a page). Context version stays 1: the ticket context did not change.
- **`tikki:navigate`**: `appNavigationPath` in `shared/app-navigation.ts`. It checks the raw string (prefix `/tickets/` or `/apps/`, no `//`, no backslash, no white space or control character), then resolves it with `new URL` and checks the path again, because the browser resolves `..` and `%2e%2e` (`/tickets/%2e%2e/sign-out` would open `/sign-out`). It navigates to the resolved path. Any other value is ignored without an answer. Handled in `TicketAppFrame.vue`, so it works from every placement.
- **`TicketAppFrame.vue`** takes `url` and an optional ticket (`ticketRef`, `ticketVersion`). The page placement uses the page token route. `tikki:refresh` from a page does nothing (the page has no listener).
- **Menu list**: `useAppPages()` keeps one list for the sidebar and the page, with one shared request. The sidebar loads it again on each path change (an Admin's change shows on the next navigation), and clears it when it unmounts (sign-out), so the next User never sees the old list.
- **Page layout**: `UDashboardNavbar` with the icon and the name as `h1` at every width (the other pages show their navbar on phones only), then the frame with no card and no radius, filling the body.
- **Icon**: `AppPageIcon.vue` (the Lucide `app-window` icon) is the one place for the icon in the menu and the page header. Issue 38 replaces it with `TicketAppIcon`.

## Notes for later issues

- Issue 38: swap `AppPageIcon.vue` for `TicketAppIcon`. The menu payload (`AppPageView` in `ticket-apps.ts`, `AppPage` in `app/types/ticket-apps.ts`) has only `id`, `name`, `url`: add the icon fields there. If a Requester may read the icon of a page shown to them, check it with `visibleAppPages`, not `authorizeTicketApps` (staff only).
- Issue 38 merge: text conflicts are certain in `ticketApp` (`schema.ts`), the one-line `audited` and the zod inputs in `ticket-apps.ts`, and the `form` and `openForm` lines in `apps.vue`. Keep both sides.
- A read-across-tickets page token (ADR 0005, Consequences) needs its own claim and its own check. Do not widen `principalForContextToken` to `page`.
- A new e2e test that counts requests by URL: `/api/v1/apps` loads on every page for every User.

## Glossary terms to add

- **App page**: the page placement of a Ticket App, at `/apps/{id}` in the Apps menu, outside any ticket. Agents and Admins see it; Requesters too when the Admin turns on "Show the page to Requesters".
- **Page token**: a context token for an app page. It proves who the User is (`sub`, `tikki_role`) and has no ticket, so the REST API refuses it.

## Blocked by

- [37 · One URL for each placement](37-ticket-app-placements.md)
