# 37 · One Ticket App, one URL for each placement

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner request, 2026-10-18: one app with different views in the sidebar, in a tab and (issue 39) as a page. Design: [ADR 0005](../adr/0005-ticket-app-placements-pages-manifest.md). Builds on issues 34 and 35.

## What to build

Today a Ticket App has one `url` and one `position`. To show one tool in the sidebar and as a tab, an Admin adds it twice. Replace both with one URL for each placement.

- A Ticket App has `sidebar_url`, `tab_url` and `page_url`. Each is optional; at least one is required (422 otherwise). A placement is on when its URL is set. `page_url` is stored and validated here, but only issue 39 shows it.
- Each URL follows the rules of `appUrlProblem` (HTTPS; `http://` only on a loopback address in development and test; never Tikki's own origin). The URLs may be on different origins.
- **Migration:** add the three columns; copy `url` into `sidebar_url` or `tab_url` from `position`; then drop `url` and `position` (a table rebuild: follow `docs/agents/parallel-work.md`; no other table has a foreign key to `ticket_app`). Two apps that differ only in position stay two apps; the Admin can merge them by hand.
- **The frame URL** gets `?placement=sidebar|tab` (kept with any query the Admin wrote). The context gets `app.placement`.
- **Token:** a new claim `tikki_placement`. `aud` is the origin of that placement's URL. The token route takes the placement: `POST /api/v1/tickets/{ref}/apps/{appId}/token` with `{ placement }`; 404 when the app has no URL for it. `principalForContextToken` checks `aud` against the origin of the URL of `tikki_placement`, not against any URL of the app.
- **API shape:** `GET /api/v1/tickets/{ref}/apps` and the admin routes return `urls: { sidebar, tab, page }` (null when not set) in place of `url` and `position`.
- **Admin form:** three URL fields with a short help line each ("A card in the ticket sidebar", "A tab next to Conversation and Activity", "A page in the Apps menu (coming soon)" until 39). The app list shows a chip for each placement that is on.
- **Ticket page:** an app with both URLs shows as a sidebar card and as a tab.
- **Docs:** `docs/ticket-apps.md`: Add the app (the three fields), Positions → Placements, the context (`app.placement`), the token claims (`tikki_placement`), and the example apps' setup. `examples/ticket-app` and `examples/time-tracking` keep working (one URL each).

## Acceptance criteria

- [x] Test: create with no URL gets 422; with only `tab_url` works; each URL is checked like before (HTTP outside development, Tikki's own origin).
- [x] Test: the migration keeps every app, maps `position` to the right column, and `test/worker/migrations.test.ts` passes.
- [x] Test: a token for `sidebar` has the sidebar URL's origin as `aud` and `tikki_placement: 'sidebar'`. The token route answers 404 for a placement the app does not have.
- [x] Test: with the sidebar and tab URLs on two origins, a sidebar token used with `tikki_placement` changed, or presented by the tab origin, gets 401 on the REST API.
- [x] Playwright: one app with a sidebar URL and a tab URL shows a card and a tab. Each frame gets its own `placement` in the URL and in the context.
- [x] The layout spec passes. The guide matches the build.

### Evidence

- 422 and URL rules: `test/worker/ticket-apps.test.ts` "answers 422 for a bad URL, no URL, …" (each rule for each of the three keys; old `url`/`position` refused). Only `tab_url`, and PATCH that removes the last URL: `test/worker/ticket-app-placements.test.ts` "creates an app with only a tab URL …".
- Migration: `test/worker/migrations.test.ts` "issue 37: maps each app's url …" (ids, both positions, two apps that differ only in position stay two, the counter, the CHECK) and the generic data-keeping test. Also applied by hand to a copy of the 8790 server's database: its three apps (two sidebar, one tab) moved to the right columns.
- Token claims and 404: `ticket-app-placements.test.ts` "names its placement …" and "answers 404 for a placement …".
- Two origins, 401: `ticket-app-placements.test.ts` "with two origins, …" (re-signed with Tikki's key: changed `tikki_placement`, `aud` of the tab origin, `page`, no claim; a re-signed control passes) and "stops a placement's tokens when its URL is removed or moves".
- Playwright: `e2e/ticket-apps.spec.ts` "one app with a sidebar URL and a tab URL shows a card and a tab, …" (tab on another origin; URL, `app.placement`, `aud`, `tikki_placement` of each frame).
- Layout: `e2e/layout.spec.ts` now seeds one app with both URLs; it passes. The guide is updated (Add the app, Placements, `app.placement`, `tikki_placement`, errors, FAQ, local test).
- Seen in a browser on the dev server (8837): the admin list and the edit dialog at 375 px dark and desktop light; the ticket page with the card at 375 px dark and the tab and card at desktop light. No horizontal scroll at 375 px.
- Runs: `pnpm test` 445 passed (41 files); `pnpm typecheck` passes; `E2E_PORT=9837 pnpm e2e` 95 passed in two runs after the locator fix.
- Reviewer (opus, `git diff integration...issue-37`): no blocking findings. Fixed: the guide now says a `placement` in the Admin's URL is replaced; the first e2e test asserts `app.placement`. The edit dialog was checked by hand (see Not verified).

## Not verified

- The deployed time tracking app (`time.jithinsha.in`) after this migration on the deployed Tikki. Its setup docs now say "Sidebar URL"; the app code reads no `position`.
- The edit dialog has no layout spec entry (the layout spec visits pages, not dialogs). It was checked by hand only.

## Blocked by

None. Builds on issues 34 and 35.

## Decisions made here

- **Request and answer shapes.** Admin requests send `sidebar_url`, `tab_url`, `page_url` (the spec's names). Answers have `urls: { sidebar, tab, page }`. Null or an empty string turns a placement off. A PATCH that leaves no URL gets 422 with key `urls`. The old `url` and `position` fields get 422 (strict object).
- **CHECK in the database**: `ticket_app_one_url` (at least one URL is set). The API refuses it first; the CHECK makes a bad write fail visibly.
- **Placements**: `TICKET_APP_PLACEMENTS = ['sidebar', 'tab', 'page']` in `schema.ts`. `FRAME_PLACEMENTS = ['sidebar', 'tab']` in `server/utils/ticket-apps.ts` are the ones in a ticket. The token route takes only these; `page` gets 422 until issue 39.
- **Token route** `POST /api/v1/tickets/{ref}/apps/{appId}/token` takes `{ placement }` (422 when missing or unknown). 404 when the app has no URL for it, like an app that is off.
- **Context**: `app.placement` replaces `app.position`. The context version stays 1: no app outside this repository used `position` yet.
- **Token check**: `principalForContextToken` needs `tikki_placement` (`sidebar` or `tab`) and compares `aud` with the origin of that one URL. A token without the claim (made before this version) gets 401. It lives 5 minutes, so no grace rule.
- **Frame URL**: `URL.searchParams.set('placement', …)`: the Admin's query and hash stay; a `placement` the Admin wrote is replaced.
- **Ticket page**: one app with both URLs is one entry in `GET /api/v1/tickets/{ref}/apps`. The page shows a card for `urls.sidebar` and a tab for `urls.tab`. Both frames have the app name as `title`; `data-placement` tells them apart.
- **Audit**: `ticket_app_changed` names `sidebar_url`, `tab_url`, `page_url`. Old entries keep `url` and `position`.
- **Migration** `0025_issue_37_ticket_app_placements.sql`: a table rebuild with `__new_ticket_app` (no foreign key points at `ticket_app`). A `position` other than `tab` goes to `sidebar_url`, so a row with an unexpected value keeps its URL. The AUTOINCREMENT counter is kept, as in 0014, so the id of a deleted app in the audit log is never used again.
- **e2e text locators in the admin dialog are exact.** The new help line "Each must use https" and "Set at least one URL" also matched `getByText('Must use https.')` and `getByText('at least one')`. Before the fix the admin test passed on the help line alone when it was faster than the server's error, and failed in strict mode when both were visible (seen once in three runs).
- **Admin form**: a "Where it shows" group with one URL field for each placement, from the `PLACEMENTS` list in `apps.vue`. Each row shows a chip and the URL for each placement that is on.

## Notes for later issues

- Issue 38 and 39 extend `ticket_app` again. A rebuild must keep the CHECK `ticket_app_one_url` and the `sqlite_sequence` copy of 0025, and add `ticket_app` to `OVERRIDES` in `migrations.test.ts` only if a new NOT NULL column has no default.
- Issue 39: `page` is in `TICKET_APP_PLACEMENTS` but not in `FRAME_PLACEMENTS`; the token route answers 422 for it. A page token needs its own route or its own claim set (ADR 0005: no `tikki_ticket`). `principalForContextToken` accepts only `sidebar` and `tab`, so a page token can never reach the REST API through it. Remove "(coming soon)" from the Page URL help line in `apps.vue` and from the guide.
- Issue 38: the admin form's per-placement list (`PLACEMENTS` in `apps.vue`) and the row chips are the places to add icons next to.

## Glossary terms to add

None. CONTEXT.md already has Placement.
