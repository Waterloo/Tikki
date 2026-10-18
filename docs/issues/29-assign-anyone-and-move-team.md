# 29 · Assign to any Agent, and move a ticket to another Team

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Agents hand a ticket to the right person and the right Team. For example, a bug lands in Support, and Support moves it to Development.

- **Assign to anyone.** The ticket page has an assignee picker that lists the active Agents and Admins, with the members of the ticket's Team first. "Assign to me" stays as a one-click action. The MCP tool `assign_ticket` accepts `me`, `none`, or the email of an Agent.
- **A Team for each ticket.** A ticket has its own Team. A new ticket gets the Team of its Ticket Type. Agents and Admins move a ticket to another Team from the properties panel. A Ticket Type change sets the Team to the Team of the new type.
- Moving keeps the assignee. The members of the new Team get a "moved to your Team" notice (on a Restricted ticket, Participants only). The move is in the Activity and the audit log, and it is a `ticket.updated` Event with `team` in `changed`.
- The agent list gets a Team filter, and the ticket view, search results and webhook payloads show the ticket's Team, not the type's Team.
- Requesters and Applications cannot assign or move. An Application sees no Team name (staff privacy, issue 13).

## Acceptance criteria

- [x] REST test: an Agent assigns a ticket to another active Agent. A Requester, a deactivated User or an unknown User as assignee is refused. Evidence: `test/worker/ticket-team.test.ts` > assign to any Agent (a Requester, a deactivated User and an unknown ID give 422 `assignee_id`).
- [x] REST test: a new ticket has the Team of its type. An Agent moves it to another Team; the type's Team does not change. Evidence: `ticket-team.test.ts` > starts with the Team of its type, and a move changes the ticket, not the type.
- [x] REST test: a type change sets the ticket's Team to the new type's Team. Evidence: `ticket-team.test.ts` > a type change sets the Team of the new type, also after a manual move.
- [x] REST test: a Requester and an Application cannot assign or move (same refusals as the other Agent actions). Evidence: `ticket-team.test.ts`: a Requester gets 403 on `team_id`; an Application gets 403 on `team_id` and `assignee_id` (in 'an Application sees no Team').
- [x] Notice test: members of the new Team get the notice; the actor does not; on a Restricted ticket only Participants. Evidence: `ticket-team.test.ts` > moved_to_team notice (members only, not the actor; Restricted: the assignee only).
- [x] Delivery test: the Event has `team` in `changed`, and `before`/`after` show the two Teams. Evidence: `ticket-team.test.ts` > writes a ticket.updated Event with `team` in `changed` and both Teams in before and after.
- [x] REST test: the Team filter on the list returns only that Team's tickets, by the ticket's Team. Evidence: `ticket-team.test.ts` > the list filter uses the ticket's Team, not the type's.
- [x] MCP test: `assign_ticket` with an Agent's email assigns; with a Requester's email it is refused. Evidence: `ticket-team.test.ts` > MCP: `assign_ticket` by email, `me`, `none`; a Requester's or unknown email is refused like REST; `move_ticket_team`.
- [x] Playwright flow: a Support Agent moves a ticket to Development and assigns it to a Development Agent; that Agent sees it under "Assigned to me". Evidence: `e2e/assign-and-move.spec.ts` (passes; the full suite of 30 passes).

## Blocked by

None. Builds on issues 05, 06, 08, 10, 14, 18, 20 and 27 (all done).

## Not verified

- The ticket page (Team select, assignee picker) was checked in a browser in dark mode at desktop width and in light mode at 375 px (no horizontal scroll), and the Team filter on the list at 375 px light. I did not check the list filter in dark mode or the Inbox row for `moved_to_team` by eye (the e2e checks its text). The canvas has no assignee picker or Team control, so both follow the existing select style.
- Email for `moved_to_team` is covered by the type system only (`PREFERENCE_OF` must list every kind), not by a mail test.

## Decisions made here

- **Storage**: `ticket.team_id`, nullable (SQLite cannot add NOT NULL with a foreign key without a rebuild of `ticket`, which many tables reference), backfilled from the type in migration `0022_issue_29_ticket_team.sql` (renumber at merge), indexed (`ticket_team_idx`). `toSummary` throws on a ticket without a Team, like Status.
- **Where the Team is read**: `summaryColumns` joins `ticket.team_id`; every list, search, similar and detail view gets `team` from it. `noticeTicketCreated`, the webhook `ticketJson` and the list filter use `ticket.team_id`. Only create and the type change read the type's Team.
- **Create**: REST, MCP and Application creates set `team_id` from the type in `checkNewTicket`. Reopen-as-new (issue 09) also takes the type's Team (a SQL subquery), not the old ticket's Team, as for any new ticket.
- **Type change** (08): the same `applyChange` sets `team_id` to the new type's Team. When that differs from the ticket's Team, it also writes a `team_changed` entry, so the Activity, the Event (`changed` has `ticket_type` and `team`) and the `moved_to_team` notice are the same as for a manual move.
- **Move**: `PATCH team_id`, policy action `move_team` (staff only, in `allowed_actions`), audit `team_changed` with `{ id, name }` in `before` and `after` (names stay readable after a rename; Erasure clears both like any entry). `changedKey` is `team`. A move to the current Team is a no-op (no entry). Unknown Team: 422 `team_id`. The assignee stays. `team_changed` is not revertible.
- **Notice `moved_to_team`**: members of the new Team, not the actor; a Restricted ticket goes to its assignee and added Participants only. A new Team with no members tells every Agent and Admin, like `ticket_created` (shared `teamRecipient` SQL). The text is "<actor> moved <ref> to <Team>"; the Team name is in `notification.data`. It shares the `team_ticket` email switch; the switch label is now "A ticket arrives for, or moves to, my team". `NOTIFICATION_KINDS` and `AUDIT_ACTIONS` are TypeScript enums, so no SQL change.
- **Assign**: `canBeAssignee` unchanged; the `assignee_id` check now also refuses a deactivated User (message "Must be the ID of an active Agent or Admin."). New `GET /api/v1/assignees` for Agents and Admins (403 for others): active Agents and Admins with `team_ids`, and the Teams. It lists no Requesters. The Team picker and the list Team filter use its `teams`, because `GET /api/v1/teams` is Admin-only.
- **MCP**: `assign_ticket` takes `me`, `none` (`nobody` still works) or an email (case-insensitive). The policy answers first (a Requester gets FORBIDDEN). An unknown email fails like an unknown ID. New tool `move_ticket_team` takes the Team name (case-insensitive) and lists the Team names when it is unknown. MCP ticket summaries include `team` (name).
- **Applications**: `team` is left out of every ticket view for an Application (`forViewer`; the OpenAPI field is optional). `team` is removed from `before`/`after` of its webhook payload, and a `ticket.updated` whose only change is `team` is not delivered to an Application endpoint (`changed` is also filtered). `team_changed` entries are hidden from its Activity. Its `PATCH` with `team_id` or `assignee_id` is 403. The type endpoints still show the type's Team to an Application (that is the type, not a ticket fact); not changed here.
- **Removing a Team** is also refused (409 `TEAM_HAS_TICKETS`) while any ticket, deleted ones included, is in it, because `ticket.team_id` is a foreign key. Test: `ticket-team.test.ts` > removing a Team.
- **UI**: ticket page: a Team select (only with `move_team`; else the name), and a grouped assignee picker ("<Team> members", then "Other Agents"; "Agents" when the Team has no members) next to the kept "Assign to me" and "Unassign" buttons. List: a Team menu when more than one Team exists.

## Glossary terms to add

None. (Team is already updated in CONTEXT.md.)

## Notes for later issues

- Anything that needs "the ticket's Team" must read `ticket.team_id`, never `ticket_type.team_id`. `ticket_type.team_id` is only the Team of a new ticket.
- A new notice writer to a Team should use `teamRecipient` in `notifications.ts` (Restricted rule and empty-Team rule).
- `listAssignees` / `GET /api/v1/assignees` is the staff-only source for pickers; extend it there, not in the People list.
- An Agent's queue is still not filtered by Team; the Team filter is a menu, not a default.

