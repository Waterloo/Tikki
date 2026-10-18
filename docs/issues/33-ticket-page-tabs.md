# 33 · Ticket page tabs: Conversation and Activity

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner feedback on the ticket page, 2026-10-18: activity entries crowd out the conversation.

## What to build

Today one section, "Conversation and activity", mixes comments with every Field change, assignment and Status change. On a busy ticket the replies get lost between the changes.

- The main column gets tabs below Attachments:
  - **Conversation** (default): Public Comments and Internal Comments in time order, with the composer below them. Above the first comment, one quiet line shows the latest Activity entry ("Sam assigned this ticket to Ana · 1 hr ago"). A click on it opens the Activity tab.
  - **Activity**: every change, with Revert where it is allowed today (issue 06). The ticket creation is the first entry.
- Internal notes and public replies stay in one tab. An Agent must see the internal note before answering the customer.
- A Requester sees the same tabs. Their Conversation has only Public Comments, and their Activity has only what the read rule shows them today. No new data reaches anyone.
- The tab is in the URL (`?tab=activity`). A reload and a shared link open the same tab. An unknown value opens Conversation.
- The tab bar has room for more tabs: issue 34 adds one tab for each Ticket App with the `tab` position.
- Keyboard: the tabs use the tab pattern (arrow keys move between tabs). Use the Nuxt UI tabs component.

## Acceptance criteria

- [x] Playwright: a ticket opens on Conversation. It shows comments and the latest-change line, and no other Activity entries.
  Evidence: `e2e/ticket-tabs.spec.ts`: the ticket opens on Conversation with both comments and one latest-change line. The older priority change and the creation entry are not visible.
- [x] Playwright: the Activity tab shows the changes, Revert works there, and the URL has `?tab=activity`. A reload stays on Activity.
  Evidence: `e2e/ticket-tabs.spec.ts`: the latest-change line opens Activity, URL is `?tab=activity`, Revert works, a reload stays on Activity.
- [x] Playwright: a Requester sees no Internal Comments in Conversation and no internal changes in Activity (the same rule as today).
  Evidence: `e2e/ticket-tabs.spec.ts`: the Requester sees no Internal Comment in either tab. Activity shows what the read rule shows today (server unchanged).
- [x] Playwright: a new comment appears in Conversation without a reload. A Status change updates the latest-change line.
  Evidence: `e2e/ticket-tabs.spec.ts`: a new note shows without a reload. A Status change updates the line.
- [x] The layout spec passes (375, 1100, 1280, 1440 px, light and dark).
  Evidence: `e2e/layout.spec.ts` passes (full e2e run).

## Blocked by

None. Builds on issues 06 and 31.

## Not verified

- Screenshots came from headless Playwright at 375 and 1280 px, light and dark, not from a live browser pane. The Requester page was not screenshotted.
- Arrow-key tab movement is covered for Activity to Conversation only.

## Decisions made here

- The tabs live in `TicketConversation.vue` (Nuxt UI `UTabs`, `variant="link"`, `unmount-on-hide=false`). Panels stay mounted, so a half-written reply survives a tab switch. Issue 34 adds one entry to the `tabs` array with a matching slot, and renders an iframe in that slot only after the first open.
- The tab is `?tab=activity`. Conversation drops the parameter. An unknown value shows Conversation without a redirect.
- The latest-change line is the last Activity entry, including creation. It is a button that opens Activity.
- Hidden panels stay in the DOM, so Playwright `getByText` can match twice. Tests use the Activity tab or the latest-change button.
- No server change, no migration.

## Notes for later issues

- A button named "Latest change: ..." contains the word "Revert" when the last entry is a revert. Use `exact: true` when you look for the Revert button.
