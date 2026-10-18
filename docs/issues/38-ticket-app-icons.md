# 38 · Ticket App icons, light and dark

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner request, 2026-10-18. Design: [ADR 0005](../adr/0005-ticket-app-placements-pages-manifest.md).

## What to build

Each Ticket App gets an icon. It shows on the sidebar card title, on the app's tab, in the Apps menu (issue 39) and on the admin list.

- **Built-in icon** (default): an icon from the same Lucide set and the same color choices as Ticket Types (`TypeAppearance` / `TypeTile`). It follows light and dark mode as Ticket Type icons do. Default: `app-window`, neutral.
- **Custom image:** the Admin uploads a **light** image and, optionally, a **dark** image. Without a dark image, the light one is used in dark mode.
  - PNG, WebP or SVG. At most 256 KB each. Square is recommended; Tikki shows it in a square box with `object-fit: contain`.
  - Stored in R2 (key under `ticket-app-icons/`). Served from Tikki by `GET /api/v1/ticket-apps/{id}/icon?mode=light|dark`, with the same headers as the organization logo (`Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`, the stored type) and a cache header with a version in the URL (`?v=`), so a new upload shows at once.
  - Readable by every signed-in User who can see the app (staff; plus Requesters for page apps that are shown to them in issue 39). Never public without a session.
  - Check the type from the bytes (magic numbers, and `<svg` for SVG), not from the name or the header.
- **No icon URL on the app's own site.** Every Agent's browser would load it on each page: it leaks who uses Tikki and when. Issue 40 downloads manifest icons once instead.
- **Admin form:** "Icon": the built-in picker, or "Upload image" with two drop zones (Light, Dark) and a live preview on a light and a dark tile. Remove each image on its own.
- Admin audit: `ticket_app_changed` with `icon` before and after (the kind and the version, not the bytes).
- Deleting an app deletes its icon objects (after the row, in `waitUntil`, like other R2 deletes).

## Acceptance criteria

- [x] Test: upload light and dark; the icon route answers each with the stored type and the sandbox CSP; a missing dark image answers the light one.
- [x] Test: a file over 256 KB, a GIF, and an HTML file named `.svg` get 422.
- [x] Test: without a session the icon route answers 401; a Requester gets 404 for a staff-only app.
- [x] Test: deleting the app removes the R2 objects.
- [x] Playwright: an app with a built-in icon and an app with light and dark images show the right icon on the card, the tab and the admin list, in light and in dark mode.
- [x] The layout spec passes.

### Evidence

- Upload, serve, types, missing dark: `test/worker/ticket-app-icons.test.ts` "serves the light and the dark image …", "answers the light image when there is no dark image …".
- 422: "refuses a file over 256 KB, a GIF and an HTML file that is named .svg with 422" (also an empty body; exactly 256 KB passes). The request header says `text/html` in every upload: the type comes from the bytes.
- 401 and 404: "answers 401 without a session, and 404 to a Requester …", "never serves the image to an API key or a context token without a session".
- R2 delete: "deletes the icon objects with the app", "removes the dark image alone, and the dark image with the light one".
- Playwright: `e2e/ticket-apps.spec.ts` "app icons show on the card, the tab and the admin list" in light and dark, and "the admin form uploads …". `e2e/layout.spec.ts` seeds light and dark images and passes.
- Migration: `migrations.test.ts` "issue 38: …".
- Seen in a browser on the dev server (8838): the ticket page (card and tab) at 375 px light and dark and at desktop dark; the admin list at 375 px dark; the edit dialog in image mode at 375 px dark and in built-in mode at desktop light. No horizontal scroll at 375 px.
- Runs: see the final report of the lead (counts are in the commit that closes this issue).
- Reviewer (opus): fixed the exact locators, the missing test for an API key and a context token, and the content type (now from the R2 object). Answered below.

## Not verified

- The edit dialog at desktop dark and 375 px light. The layout spec does not open dialogs.
- An upload that fails after R2 and before D1 (no test).

## Decisions made here

- **Columns** (plain `ADD`): `icon_name` (default `i-lucide-app-window`), `icon_color` (default `#4B5563`, Slate), `icon_light_type`, `icon_dark_type` (null: no image), `icon_version` (+1 on each image change). A light type means the icon is an image.
- **R2 keys** `ticket-app-icons/{id}/light` and `/dark`. One object for each mode, overwritten by a new upload. A failed row update after the put can leave new bytes under the old `?v=`; the route sends the type of the object, so type and bytes always match. A key with a version would close the rest; the window is one request.
- **Removing the light image also removes the dark image.** A dark image alone would show only in dark mode. The spec said "remove each on its own": the dark one can be removed alone. A dark upload without a light image gets 422.
- **Routes:** `PUT` and `DELETE /api/v1/admin/ticket-apps/{id}/icon?mode=light|dark` (body is the image; answer is the app). `GET /api/v1/ticket-apps/{id}/icon?mode=` (default `light`; a bad mode gets 422). Built-in icon and color: `icon_name` and `icon_color` in POST and PATCH, checked against the Ticket App icon list and the Ticket Type colors.
- **Icon list:** `APP_ICONS` in `shared/ticket-app-icons.ts` = `app-window` + the Ticket Type icons. `TypeAppearance` got an optional `icons` prop.
- **Cache header** `private, max-age=31536000, immutable`: the route needs a session, so it is never `public`.
- **Policy:** `authorizeTicketAppIcon` in `policy.ts`. Staff see every app (also a disabled one: the Admin list shows it). A Requester gets 404.
- **Audit:** the `icon` object (kind, name, color, light, dark, version) in `before` and `after` of `ticket_app_changed`, also on create and delete.
- **API shape:** every app has `icon`, also in `GET /api/v1/tickets/{ref}/apps`.
- **`readLimited`** in `settings.ts` takes the limit and the error, so the logo and the icons share it.
- **Admin form:** `TicketAppIconField.vue` stages files; the parent calls `commit(appId)` after the save. A failed upload keeps the form open and the app is then in edit mode.

## Notes for later issues

- Issue 39: use `<TicketAppIcon :app size>` (`app` needs `id` and `icon`; sizes `xs`, `sm`, `md`, `lg`) in the Apps menu. `authorizeTicketAppIcon(principal)` takes no app facts; for Requesters on a shown page app, pass the facts and call it after the row is read (`icon.get.ts`).
- Both issues add a migration: renumber with the script and make the snapshot again, so it holds both branches' columns.
- Issue 40: a manifest icon is downloaded once and stored with `setTicketAppIcon`'s rules (bytes check, 256 KB); it needs a function that takes bytes, not a `Request`.

## Glossary terms to add

None.

## Blocked by

- [37 · One URL for each placement](37-ticket-app-placements.md)
