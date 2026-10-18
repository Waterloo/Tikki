# 27 · Restricted tickets: Participants only

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Some requests are sensitive, for example a data request. Only the people on the ticket and the Admins may see it.

- A Ticket Type gets a third visibility, "Participants only", next to "Requester only" and "visible to all internal users". An Admin sets it in the type editor. Every ticket of that type is a Restricted ticket.
- Participants of a ticket: the Requester, the assignee (assigning someone adds them), and the Users that are added. The Requester, the assignee and Admins add and remove Participants. A Participant reads the ticket, comments on it, and gets its notices.
- On a Restricted ticket only its Participants and the Admins see the ticket. For every other User, Agents included, it answers NOT_FOUND, the same as a ticket that does not exist.
- The rule is in the one read rule of the policy module, so lists, search, similar tickets, counts, detail, comments, Activity, attachments, MCP, REST and the Inbox follow it.
- Notices for a Restricted ticket go to its Participants only. The "ticket created" notice does not go to the owning Team.
- Admin Webhook Endpoints get no Event for a Restricted ticket, unless the endpoint has "include internal data". Applications cannot create or read tickets of a Restricted type.
- Adding and removing a Participant is in the Activity and the audit log.
- The ticket page shows a Participants panel (add with a search of Users, remove). The type list shows the new visibility.

## Acceptance criteria

Checked on 2026-10-18. `pnpm test` (362 tests, 30 files), `pnpm typecheck` and `E2E_PORT=8871 pnpm e2e` (28 passed, 2 of them setup) pass.

- [x] REST test: an Agent who is not a Participant gets NOT_FOUND for a Restricted ticket on read, list, search, similar tickets, comments, Activity and attachment download. The counts leave it out. Evidence: `test/worker/restricted.test.ts` ("answers NOT_FOUND to an Agent who is not a Participant..."): detail by reference and number, comments, Activity, attachments, Participants and the attachment download answer 404 with the same body as a ticket that does not exist; comment, PATCH and add Participant answer 404; list, search by word and by reference, type filter and similar tickets answer 200 without the title; the list `counts` are equal before and after the ticket exists. The same lists show it to the owner and an Admin. The Inbox and its unread count also leave it out ("hides the notices of a removed Participant...").
- [x] REST test: the Requester, the assignee, an added Participant and an Admin can read it. A removed Participant cannot. Evidence: `restricted.test.ts` ("lets the Requester, the assignee, an added Participant and an Admin read it..."), also: assign makes a Participant, unassign removes the right unless the User was also added.
- [x] REST test: only the Requester, the assignee and Admins can add or remove Participants. Each change writes an audit entry. Evidence: `restricted.test.ts` ("only the Requester, the assignee and Admins add or remove..."): an added Participant gets 403 FORBIDDEN and has no `manage_participants` in `allowed_actions`; every add and remove has one `participant_added`/`participant_removed` row with the actor and the User ID, and Activity names the User. "refuses a deactivated User, the Requester, a repeat..." checks the 422 refusals and that a refused repeat writes no entry.
- [x] MCP test: `get_ticket`, `search_tickets` and `list_my_tickets` follow the same rule. Evidence: `restricted.test.ts` ("get_ticket, search_tickets and list_my_tickets follow the same rule").
- [x] Notice test: "ticket created" and comment notices for a Restricted ticket go only to Participants. Evidence: `restricted.test.ts` ("\"ticket created\" goes to no Team member..."): no `ticket_created` notice at all (the Requester is the actor and no one else is a Participant yet); a Public Comment goes to the assignee and both added Participants; an Internal Comment goes to the added Agent only (not to an added Requester-role User); an outside Agent and an Admin get nothing.
- [x] Delivery test: an Admin endpoint without "include internal data" gets no Event for a Restricted ticket. One with it gets the Event. Evidence: `test/worker/webhooks.test.ts` ("sends no Event for a Restricted ticket to an endpoint without..."): created, comment and update Events; the plain endpoint has no delivery rows, the internal one gets all three.
- [x] REST test: an Application cannot create a ticket of a Restricted type, and such a type is not in its allowed list. Evidence: `restricted.test.ts` ("cannot have a Restricted type in its allowed list..."): create and PATCH of an Application with the type answer 422; a type in an Application's list cannot become Participants only (422); with the type forced into the list in the database, the create answers 403 FORBIDDEN.
- [x] Playwright flow: an Agent raises a data request, adds a second Agent as Participant; a third Agent cannot open it. Evidence: `e2e/restricted.spec.ts`. It also checks the type list chip "Participants only", the Activity line, and that the third Agent's All tickets list has no title.

Screens seen in the browser pane against `wrangler dev` (port 8861): the ticket page with the Participants panel and the add search (dark, 800 px; light, 375 px, no horizontal scroll), the type editor with the three choices (light, 375 px, no horizontal scroll), the new-type form and the type list chip (dark).

## Not verified

- The type list at 375 px in the browser pane (the existing e2e "the Admin screens have no horizontal scroll at 375 px" passes; the list table scrolls inside its card as before).
- The unassign that hides the ticket from the actor (toast and return to the list) was not driven in the browser; the server side is in the read-rule test.
- CPU time per route was not measured. The read rule adds one indexed `EXISTS` per row in lists and one small `json_group_array` subquery in the detail.
- The migration on a database with data: applied on the local dev database (3 seeded types became `requester`), but not on a copy of production data.

## Decisions made here

1. **API field.** `visible_to_all` is gone from the API; `visibility` (`requester` | `internal` | `participants`) replaces it on the type views, the type editor input, and the OpenAPI document. Keeping both for a release would need two writable fields that can disagree; the only callers were this repo's UI and tests, all updated. External clients that read `visible_to_all` on `GET /api/v1/ticket-types` break.
2. **Migration.** `0020_issue_27_restricted_tickets`: `ticket_type.visibility` text NOT NULL default `requester`, filled from `visible_to_all` (true → `internal`, false → `requester`), then `visible_to_all` dropped. New table `ticket_participant (ticket_number, user_id, added_by, added_at)`, primary key (ticket_number, user_id), index on user_id.
3. **Read rule.** In `canRead` and `readableTickets` only. Restricted: Admin, or Requester, or assignee, or a `ticket_participant` row. `PolicyTicket` has `assigneeId`, `visibility` and `participantIds` (the detail query reads them with one `json_group_array` subquery). An Application never reads a Restricted ticket, also one it created before its type changed.
4. **Inbox follows the read rule.** A notice shows only while its ticket is readable for the User (`readableTickets` in `mine()`), which replaces the deleted-ticket check. So a removed Participant loses the notices (and the unread count drops) and gets them back if added again. A User who lost a staff role also loses notices of tickets they can no longer read.
5. **Who manages.** New policy action `manage_participants`: the Requester (a User), the assignee, and Admins; only on a Restricted ticket (403 otherwise, so the panel shows only there). An added Participant reads and comments but does not add or remove.
6. **Who can be added.** Any active User, Requester-role Users too; not the Requester (always one); the assignee can be added, so they keep the ticket after unassign. Deactivated or unknown User, or a repeat: 422. Remove of a User without a row: 404 with a message that says the Requester and assignee are Participants by rule.
7. **Picker.** `GET /api/v1/tickets/{ref}/participants/candidates?q=` lists up to 10 active Users not yet added, by name or email, to those who may manage. This shows names and emails to a Requester-role Requester of a Restricted ticket, which the old screens did not; it is needed to add colleagues.
8. **Routes.** `GET/POST /api/v1/tickets/{ref}/participants`, `DELETE /api/v1/tickets/{ref}/participants/{userId}`, `GET .../participants/candidates`. Session only (no API key, no MCP tool): Applications have no Restricted tickets, and no MCP tool was asked for. Each answers the new list.
9. **Audit and Activity.** `participant_added` / `participant_removed` with the User ID in `after` / `before`, in the same `db.batch` as the row. Activity names the User. A repeat add is refused by the primary key, so the batch writes nothing. Remove reads the row first; two removes at the same moment could write two entries.
10. **No Event and no notice for a Participant change.** There is no `changed` key or notice kind for it; the change is in Activity and the audit log only.
11. **Notices.** "Ticket created" on a Restricted ticket goes to the assignee and added Participants (staff), never the Team. Public Comment: Requester, assignee, and added Participants. Internal Comment: assignee and added staff Participants. Status change and assignment are unchanged (they go to the Requester and the new assignee, who are Participants). Deactivated added Participants get no notice. Email follows the notices.
12. **Webhooks.** In `fanOut`: a Restricted ticket counts as internal data for Admin endpoints (only `include_internal = 1`), and Application endpoints never get it. The check is at fan-out time: an Event for a ticket that just moved out of a Restricted type goes out with its `before` view.
13. **Type change.** Moving a Contact's ticket into a Participants-only type is refused (422). Moving any ticket into it is refused (422) when the actor would no longer be able to read it ("Assign the ticket to yourself first"), so a change never answers "not found".
14. **Unassign that hides the ticket.** An Agent who unassigns themself from a Restricted ticket without being added gets 404 after the change is saved. The ticket page treats that as success, says why, and returns to the list.
15. **Type editor guard.** A type in an Application's allowed list cannot be set to Participants only (422 on `visibility`, naming the Application).
16. **Seeded "Data request" type stays `requester`.** Making it Participants only would hide Requesters' data requests from the Team's queue; Admins choose per type.
17. **UI.** No canvas screen: the Participants panel follows the properties cards of `Ticket.dc.html` (lock icon, list with Requester/Assignee tags, remove button on added rows, search field with results below). The type editor's switch became a radio group "Who sees these tickets" with three choices (shared `TypeVisibility` component, also on the new-type form). The type list chip shows "Participants only" with a lock in amber. `TicketDetail` has `restricted: boolean`.

## Notes for later issues

- Any new query over tickets must use `readableTickets` (it now needs `ticket_type` joined, as before, and `contact`). Any new `PolicyTicket` must set `assigneeId`, `visibility` and `participantIds` (see `policyFacts` and `attachments.ts`).
- A new notice writer for a ticket must limit Restricted tickets to Participants in its SQL; `addedParticipants` in `notifications.ts` gives the added ones.
- A notice to a User who was added as Participant, and an Event for Participant changes, are not built (decision 10).
- `ticket_participant` holds no Contact data, so Erasure does not touch it.
- Team routing (issue 20 note) must not route a Restricted ticket to a queue that shows it to non-Participants.

## Blocked by

None. Builds on issues 05, 06, 12, 14, 18 and 20 (all done).
