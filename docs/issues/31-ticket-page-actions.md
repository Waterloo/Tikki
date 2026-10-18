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

- [x] Playwright: on a ticket, the only visible page button is Edit; Cancel and Delete are in the "More actions" menu.
  Evidence: `e2e/ticket-actions.spec.ts` "the only page button is Edit...": the header has 2 buttons (Edit, More actions); Cancel/Delete only as menu items.
- [x] Playwright: in edit mode, no Cancel or Delete control is visible; "Discard" leaves edit mode and the ticket Status does not change.
  Evidence: `e2e/ticket-actions.spec.ts` "edit mode has no Cancel or Delete...": no menu, no Cancel/Delete; Escape does nothing; Discard leaves the Status unchanged.
- [x] Playwright: cancelling needs the menu item and the dialog's "Cancel ticket" button; "Keep ticket" changes nothing.
  Evidence: `e2e/ticket-actions.spec.ts` "cancelling needs the menu item..." and `e2e/self-service.spec.ts` (Requester cancels through the menu).
- [x] Playwright: an Admin deletes a ticket and "Undo" in the toast restores it.
  Evidence: `e2e/ticket-actions.spec.ts` "an Admin deletes a ticket and Undo...": Undo restores it and opens the ticket again.
- [x] Playwright: an Agent assigns themself from the select's "Me (you)" option and from the small "Assign to me" link.
  Evidence: `e2e/ticket-actions.spec.ts` "an Agent assigns themself...": "Me (you)" option, "Nobody" option, and the small "Assign to me" link.
- [x] The page has no horizontal scroll at 375 px; light and dark mode checked in a browser.
  Evidence: Playwright asserts no horizontal overflow at 375 px (Admin and Requester, light and dark). Screenshots checked: `admin-*`, `requester-*` in the scratchpad `issue-31/` folder.

## Blocked by

None. Builds on issues 05, 09, 22 and 29.

## Not verified

- Screenshots were taken with headless Playwright, not a live browser pane. Only the Admin's Delete item and the Requester's Cancel item were seen in the menu; the Requester's Reopen button was covered by e2e only.
- The Undo toast is not checked at 375 px.

## Decisions made here

- Reopen stays a visible secondary (outline, neutral) button, not in the menu: for a Requester whose ticket is resolved it is the main next step. It is hidden in edit mode.
- The menu holds "Cancel this ticket…" and "Delete ticket…" (red text and icon only). The trigger is an outline icon button with aria-label "More actions".
- Assignee is one `USelectMenu`: "Me (you)", then "Nobody" (only when assigned, it unassigns), then Team members, then other Agents. The current User is removed from the Team and Agents lists, to avoid a duplicate. The old "Unassign" button is gone.
- The small "Assign to me" link (`variant="link"`) shows beside the label only when the ticket is unassigned and the User may assign. When someone else holds the ticket, the select is the way to take it.
- Undo: after delete the page goes to the list, as before. Undo calls the restore route, then opens the ticket again. The toast lasts 10 s. The Settings › Privacy path stays.
- "Change type" and the picker's "Cancel" are ghost buttons. The picker's submit stays solid because it commits a change that cannot be reverted.
- No server change, no migration.

## Notes for later issues

- The USelectMenu trigger has role `button` in Playwright (not `combobox`); USelect has role `combobox`.
