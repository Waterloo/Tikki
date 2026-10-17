# 26 · UI foundation: theme, app shell, shared parts

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

One look for every screen, so later issues reuse parts instead of styling themselves. Reference: the [design canvas](https://claude.ai/artifact/Edi1gHaRPELu8zUnXmvUxT) and DECISIONS.md section 14.

- **Theme:** Nuxt UI with a neutral gray ground, white surfaces, thin borders, and rounded corners. Geist for text, Geist Mono for Ticket References and Field Keys. Primary actions are dark (neutral solid). Blue is the accent for links and focus. Color only for meaning. Light and dark mode follow the system setting.
- **App shell:** a sidebar layout with the organization mark and name, the navigation for the signed-in User's role, and the User with "Sign out" at the bottom. On a phone, the sidebar becomes a menu. Sign-in and consent use a centered layout without the sidebar.
- **Navigation in one place:** each item says which roles see it. Only screens that exist are listed.
- **Shared parts:** Ticket Reference, Ticket Type chip (icon and color), source chip (Web, Claude, Application), and empty, loading, and error states with a next action.
- **Restyle** the existing screens (sign-in, consent, My tickets) with these parts.

## Acceptance criteria

Checked by hand in the browser against `wrangler dev` on 2026-10-18, unless a test is named.

- [x] Sign-in and My tickets match the canvas style in light mode, and are readable in dark mode (both checked). Consent uses the same layout and card; it was not opened in this check.
- [x] At 375 px width there is no horizontal scroll (`scrollWidth` 375), and the navigation opens from the menu button. (`e2e/ui-foundation.spec.ts`, "at 375 px there is no horizontal scroll and the menu button opens the navigation")
- [x] Long ticket titles are cut with an ellipsis in the list, on desktop and on a phone. (`e2e/ui-foundation.spec.ts`, "a long ticket title is cut with an ellipsis", at 375 px; desktop checked by hand.)
- [x] My tickets has designed empty, loading, and error states, and the error state has "Try again". The empty state was seen in the browser. The loading and error states were not forced in the browser.
- [x] A Requester sees only the navigation items for Requesters. Today every item is for every role, so this only becomes visible when issue 05 adds Agent items.
- [x] `pnpm test` (27 tests) and `pnpm typecheck` pass.

## Blocked by

- [01 · Walking skeleton](01-walking-skeleton.md)

Issue 03 runs at the same time. Merge 03 first, then restyle its "New ticket" screen with these parts.
