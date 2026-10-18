# 0005 · Ticket App placements, app pages, icons and manifests

**Status:** Accepted, 2026-10-18 (issues 37–40). Extends [ADR 0004](0004-ticket-apps-and-context-tokens.md).

## Context

The owner wants one app with different views in the ticket sidebar, in a ticket tab, and as a full page outside any ticket (for example a timesheet). They also want app icons for light and dark mode, and a way to add an app from a description that the app publishes.

## Decision

1. **One URL for each placement** (`sidebar_url`, `tab_url`, `page_url`), not one URL with a switch. A sidebar card can then be a small page that loads fast, static hosting needs no routing, and views may live on different origins. The frame URL also gets `?placement=`.
2. **The token names its placement** (`tikki_placement`), and `aud` is the origin of that placement's URL. The token check compares `aud` with that one URL, so a token made for one view cannot be used by another origin.
3. **A page token proves identity only.** It has `sub` and `tikki_role`, and no ticket, so the REST API refuses it. A page app cannot read tickets through Tikki. It keeps its own data (the timesheet saves the ticket title when time is logged).
4. **Pages are for staff by default**, with a per-app "Show the page to Requesters". Sidebar and tab stay staff only.
5. **`tikki:navigate`** lets an app open a Tikki path (`/tickets/…`, `/apps/…`). The iframe still cannot navigate the Tikki tab itself.
6. **Icons are a built-in icon and color, or uploaded light and dark images stored in R2.** Never an image URL on the app's site: every Agent's browser would load it on each page and tell the app who uses Tikki and when.
7. **A manifest asks; the Admin grants.** Tikki fetches the manifest on the server with the safe fetch, copies the icons, and shows a preview. The Admin can grant the requested access or less, never more. Updates are checked only when the Admin asks, and nothing changes without the Admin's approval.

## Consequences

- Migration from `url` and `position` to three URL columns (a table rebuild).
- Two kinds of context token (ticket and page). Every verifier must tell them apart; tests cover a page token on the ticket API and at `/mcp`.
- A page app that needs ticket data must store it itself or get it another way. A read-across-tickets page token is a later decision, with its own scope.
