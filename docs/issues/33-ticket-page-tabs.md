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

- [ ] Playwright: a ticket opens on Conversation. It shows comments and the latest-change line, and no other Activity entries.
- [ ] Playwright: the Activity tab shows the changes, Revert works there, and the URL has `?tab=activity`. A reload stays on Activity.
- [ ] Playwright: a Requester sees no Internal Comments in Conversation and no internal changes in Activity (the same rule as today).
- [ ] Playwright: a new comment appears in Conversation without a reload. A Status change updates the latest-change line.
- [ ] The layout spec passes (375, 1100, 1280, 1440 px, light and dark).

## Blocked by

None. Builds on issues 06 and 31.
