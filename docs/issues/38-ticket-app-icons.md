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

- [ ] Test: upload light and dark; the icon route answers each with the stored type and the sandbox CSP; a missing dark image answers the light one.
- [ ] Test: a file over 256 KB, a GIF, and an HTML file named `.svg` get 422.
- [ ] Test: without a session the icon route answers 401; a Requester gets 404 for a staff-only app.
- [ ] Test: deleting the app removes the R2 objects.
- [ ] Playwright: an app with a built-in icon and an app with light and dark images show the right icon on the card, the tab and the admin list, in light and in dark mode.
- [ ] The layout spec passes.

## Blocked by

- [37 · One URL for each placement](37-ticket-app-placements.md)
