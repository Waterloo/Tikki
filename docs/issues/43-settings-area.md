# 43 · Settings area: set-up screens leave the main sidebar

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner feedback, 2026-10-18: an Admin's sidebar has 11 items and is too crowded. The owner approved this spec on 2026-10-18.

## What to build

The main sidebar shows only daily work. The 6 set-up screens move into one Settings area with its own menu. Every URL stays the same; only the frame around the pages changes.

### Main sidebar

- Top: a primary **New ticket** button, for every role. It is an action, not a place, so it is never the current item.
- Items: Inbox, My tickets, Assigned to me (staff), All tickets (staff), then the Apps section (issue 39).
- Bottom, above the user menu: **Settings** (gear icon), Admins only. It is the current item on every page of the Settings area.
- Agents and Requesters lose nothing they use today.

### Settings area

- One frame for all set-up pages: a second left menu next to the page, in groups:
  - **General:** Organization (`/settings`).
  - **People:** Teams and users (`/people`).
  - **Tickets:** Types and fields (`/admin/types`, the type editor and the new-type page).
  - **Integrations:** Applications (`/applications`, `/applications/{id}`), Webhooks (`/webhooks`), Ticket Apps (`/admin/apps`), and Developer docs (`/docs/`, the static docs site).
- The page contents do not change. Issue 42 edits the Applications page at the same time.
- At 375 px: the Settings entry opens the menu as a list. An item opens its page, and the page has a back control to the list. No horizontal scroll. Light and dark mode.
- Keyboard and screen readers: the Settings menu is a `nav` with an accessible name, and the current item has `aria-current="page"`.

### Who sees it

- Requesters and Agents never see the Settings entry or the Settings menu.
- The Admin pages keep their checks: the page `roles` meta in the client, and the Admin check on the server. No server change.

## Acceptance criteria

- [ ] Unit: the main navigation has no set-up items. The Settings menu has the 4 groups in order, for Admins only. Each Settings URL (and its sub-pages) is in the Settings area; other URLs are not.
- [ ] Playwright: the sidebar for each role (Admin, Agent, Requester): the New ticket button, the main items, and the Settings entry for Admins only.
- [ ] Playwright: on each Settings page, the Settings menu shows with the current item marked, and the main sidebar marks Settings as current.
- [ ] Playwright: at 375 px, Settings opens the list, an item opens its page, and the back control returns to the list. No horizontal scroll.
- [ ] Playwright: an Agent and a Requester who open a Settings URL go to My tickets, and see no Settings entry.
- [ ] The e2e specs that click sidebar items still pass.
- [ ] The layout spec passes (375, 1100, 1280, 1440 px, light and dark), with the new Settings list page.

## Blocked by

None. Builds on issue 39.

## Not verified

- The live browser pane showed the desktop frame (dark). Its session was lost when I changed the pane to a phone size, so the 375 px flow and light mode were seen in headless Playwright screenshots (375 px list, page and sidebar, light and dark; 1280 px Types and fields, light and dark).
- Screen-reader output was not heard. The tests check the accessible names, the `aria-current` values and the `nav` landmarks.
- The Requester and Agent sidebars were not screenshotted; the e2e tests check their links.

## Decisions made here

- **No page file changes for the frame.** The default layout adds the Settings menu panel when `isSettingsPath(route.path)` is true and the User is an Admin. So the pages need no `layout` meta, and issue 42 can edit `applications/[[id]].vue` without a conflict.
- **`/admin` is the Settings home**: the menu as a list page (`app/pages/admin/index.vue`, Admins only). The Settings entry links there. On a phone it is the list; from 1024 px (Tailwind `lg`) its page middleware sends the User to `/settings` (Organization) with `replace`, because the menu is already next to the page.
- **Back control:** `AppPage` adds a "Back to Settings" button to the phone top bar on every Settings page except `/admin`. The menu button for the main sidebar stays.
- **Settings items are current by path prefix** (`isSettingsCurrent`), so `/applications/3`, `/admin/types/7` and `/admin/types/new` mark their item. The main items keep the full-path match, so All tickets and Assigned to me stay apart. The unused `prefix` flag on `NavItem` is removed.
- **Developer docs** opens `/docs/` in a new tab, with an external-link icon and "(opens in a new tab)" for screen readers. It is never current.
- **New ticket** is a primary `UButton` link at the top of the sidebar body, for every role. It has no `aria-current`.
- **One row component**, `SidebarLink.vue`, for the main items, the Apps items, the Settings entry and the Settings menu, so the four keep one look.
- The menu groups are `role="group"` with the group heading as name, not `section`: four extra region landmarks would make the landmark list noisy.
- No server change, no migration, no schema change.

## Notes for later issues

- The pages still show the breadcrumb "Admin / …" and the Organization page has the heading "Settings". A later issue can change them to "Settings / …" and "Organization" (this issue keeps page contents as they are, because issue 42 edits the Applications page).
- `applications/[[id]].vue` opens the first Application with `navigateTo(..., { replace: true })` after the list loads. That navigation mounts the page again, so a fast click on "New application" before it is lost. `e2e/settings.ts` `openApplications` waits for the selected Application. A page fix (for example, select the first Application without a navigation) belongs to the owner of that page.
- E2E: open a Settings page with `openSettings(page, '<item>')` from `e2e/settings.ts`. The sidebar has a second "New ticket" link on pages with a header button; scope to the sidebar (`[id^="dashboard-sidebar"]`). The page heading has a phone copy in the top bar; scope to `getByRole('banner')`.
