# 05 · Roles, policy, and the agent queue

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Agents work from one queue, and every channel enforces the same permissions.

- Roles: Admin (includes everything an Agent can do), Agent, Requester.
- One **policy function** answers "may Principal P do action A on ticket T?". REST, MCP, and the UI call it; nothing else checks permissions.
- Requesters see their own tickets, plus tickets of types with "visible to all internal users".
- Statuses are rows with a fixed Status Category; seed `open`, `in_progress`, `waiting`, `resolved`, `closed`.
- Agents change Status, Priority, and assignee ("Assign to me" in one click).
- The "All tickets" screen groups tickets by Status with counts, collapsible groups, and the All / Unassigned / Assigned to me filters. Rows show reference, title, type, Priority, Requester with source chip, assignee, last update.
- The ticket detail screen shows the description, Field values with the Schema Version label, Requester, and the properties panel.
- Empty, loading, and error states for the list and the detail screen.

## Acceptance criteria

- [x] Policy tests through REST: a Requester cannot read another Requester's ticket of a private type, but can read one of a "visible to all" type.
  Evidence: `test/worker/roles.test.ts`, "hides another Requester's ticket of a private type, and shows one of a "visible to all" type". It checks the single read (404 `NOT_FOUND`, same body as a ticket that does not exist) and the list, which uses the same rule as a query condition. The "visible to all" type is written by the test, because the Admin type editor is issue 07.
- [x] REST test: a Requester cannot change Status or assignee. An Agent can.
  Evidence: `test/worker/roles.test.ts`, "refuses Status, Priority, and assignee changes from a Requester, on their own ticket too" (403 `FORBIDDEN`, nothing changes), "answers NOT_FOUND, not FORBIDDEN, for a ticket the Requester cannot read", "lets an Agent change Status, Priority, and assignee, and an Admin too", and "tells an Agent what to fix in a bad change" (unknown Status, an assignee who is not an Agent, unknown keys, empty body).
- [x] REST and MCP return the same refusal for the same forbidden action.
  Evidence: `test/worker/roles.test.ts`, "for a Requester changing Status or assignee, and for a ticket the Requester cannot read": for `change_status`, `change_priority`, and `assign_ticket`, the MCP `structuredContent.error` equals the REST `error.code` and `error.message`. "and an Agent changes a ticket through MCP, as through REST" covers the allowed path.
- [x] The list groups by Status and the three filters return the right tickets.
  Evidence: `test/worker/roles.test.ts`, "orders tickets by Status with a count for each, and the three filters return the right tickets" (REST `assignee=none|me`, counts for each Status) and "lists the five Statuses in workflow order with their categories". `test/unit/status-groups.test.ts` covers the grouping in the UI. Checked by hand in the browser against `wrangler dev` on 2026-10-18: five groups with colored headers and counts, Resolved and Closed collapsed by default, All / Unassigned / Assigned to me (also from the sidebar) show the right rows.
- [ ] Playwright flow: an Agent opens a ticket, selects "Assign to me", and changes Status.
  Not done: Playwright is not set up in this repository yet. The same flow was done by hand in the browser against `wrangler dev` on 2026-10-18: the Admin opened BUG-1 from All tickets, chose "Assign to me" (toast "Assigned to you", the panel shows "(you)" and Unassign), then chose "In progress" (toast, the header badge changed), and BUG-1 then showed under "Assigned to me" in the In progress group.

Other checks by hand on 2026-10-18 (light and dark mode):
- At 375 px, All tickets and the ticket page have no horizontal scroll (`scrollWidth` 375); list rows become cards.
- A Requester sees only My tickets and New ticket in the sidebar, is sent from `/tickets` to My tickets, and sees the ticket page without controls (Status and Priority as badges, no "Assign to me").
- `/tickets/1` opens and the address changes to `/tickets/BUG-1`. `/tickets/ZZ-999` shows the "No ticket with this reference" empty state.
- The list error state (forced by failing the request in the browser) shows "Try again", which loads the list. The loading skeletons and the empty list states were not seen in the browser.

## Notes for later issues

- `server/utils/policy.ts` is the only place with permission rules. Add new actions to `TICKET_ACTIONS` and `authorize`; the ticket view returns `allowed_actions`, and the UI shows only those controls.
- `PATCH /api/v1/tickets/{ref}` takes `status`, `priority`, and `assignee_id` (null unassigns). Issue 09 (Requester edits) and issue 08 (type change) extend it, each key with its own policy action.
- The MCP tools `change_status`, `change_priority`, and `assign_ticket` exist now, so the refusal can be tested on both channels. Issue 11 adds the untrusted-content marker to tool results that carry ticket text; these tools return no ticket text.
- `ticket.status` is nullable in the database, for the same SQLite reason as `ticket_type.team_id`. The code always sets it and fails loudly on a ticket without one.
- `GET /api/v1/tickets` returns at most 200 tickets, in Status order, plus `counts` for each Status, so the group counts stay right when the list is cut. Issue 10 replaces the limit with cursor pagination.
- No Activity entry is written for these changes yet. Issue 06 adds the audit log.
- The icon scan now also reads `**/utils/**/*.ts` (`nuxt.config.ts`), so icons named in `app/utils/navigation.ts` are bundled.

## Blocked by

- [03 · Ticket Types with Fields](03-ticket-types-with-fields.md)
