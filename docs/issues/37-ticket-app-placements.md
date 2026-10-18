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

- [ ] Test: create with no URL gets 422; with only `tab_url` works; each URL is checked like before (HTTP outside development, Tikki's own origin).
- [ ] Test: the migration keeps every app, maps `position` to the right column, and `test/worker/migrations.test.ts` passes.
- [ ] Test: a token for `sidebar` has the sidebar URL's origin as `aud` and `tikki_placement: 'sidebar'`. The token route answers 404 for a placement the app does not have.
- [ ] Test: with the sidebar and tab URLs on two origins, a sidebar token used with `tikki_placement` changed, or presented by the tab origin, gets 401 on the REST API.
- [ ] Playwright: one app with a sidebar URL and a tab URL shows a card and a tab. Each frame gets its own `placement` in the URL and in the context.
- [ ] The layout spec passes. The guide matches the build.

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
- **Admin form**: a "Where it shows" group with one URL field for each placement, from the `PLACEMENTS` list in `apps.vue`. Each row shows a chip and the URL for each placement that is on.
