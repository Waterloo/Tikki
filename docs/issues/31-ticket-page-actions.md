# 31 · Calmer ticket page actions

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner feedback on the ticket page, 2026-10-18.

## What to build

The top of the ticket page shows Edit, "Cancel ticket" and Delete as three bordered buttons, two of them red. They look like primary actions. In edit mode "Cancel ticket" reads like "leave edit mode", so a person can cancel the ticket by mistake. "Assign to me" is the most prominent control on the page.

- **One visible page action: Edit.** "Cancel ticket", "Reopen" (when it is not the main next step) and "Delete" move into one "More actions" menu (an icon button with an aria-label) next to Edit. The red color appears only inside the menu item text and in the confirmation dialogs, not on the page.
- **Edit mode shows no ticket actions.** While editing, the action area shows only "Save changes" (primary) and "Discard" next to the form. The menu and Edit are hidden. "Discard" is the only way out, and it never changes the ticket.
- **Clear words.** The menu item is "Cancel this ticket…" with the dialog title "Cancel this ticket?" and the buttons "Keep ticket" and "Cancel ticket". The delete dialog buttons are "Keep ticket" and "Delete ticket".
- **Undo for delete.** After an Admin deletes a ticket, the toast has "Undo", which restores it (the restore route exists).
- **Quiet assignment.** The assignee is one select. "Assign to me" is the first option, "Me (you)", and a small text-style (ghost/link) "Assign to me" sits next to the "Assignee" label only when the ticket is unassigned. No filled or high-contrast button in the properties panel.
- **One visual weight in the panel.** Status, Priority, Assignee, Team and Ticket Type use the same control style. "Change type" becomes a quiet link or ghost button.

## Acceptance criteria

- [ ] Playwright: on a ticket, the only visible page button is Edit; Cancel and Delete are in the "More actions" menu.
- [ ] Playwright: in edit mode, no Cancel or Delete control is visible; "Discard" leaves edit mode and the ticket Status does not change.
- [ ] Playwright: cancelling needs the menu item and the dialog's "Cancel ticket" button; "Keep ticket" changes nothing.
- [ ] Playwright: an Admin deletes a ticket and "Undo" in the toast restores it.
- [ ] Playwright: an Agent assigns themself from the select's "Me (you)" option and from the small "Assign to me" link.
- [ ] The page has no horizontal scroll at 375 px; light and dark mode checked in a browser.

## Blocked by

None. Builds on issues 05, 09, 22 and 29.
