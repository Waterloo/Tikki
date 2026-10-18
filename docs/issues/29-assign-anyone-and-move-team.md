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

- [ ] REST test: an Agent assigns a ticket to another active Agent. A Requester, a deactivated User or an unknown User as assignee is refused.
- [ ] REST test: a new ticket has the Team of its type. An Agent moves it to another Team; the type's Team does not change.
- [ ] REST test: a type change sets the ticket's Team to the new type's Team.
- [ ] REST test: a Requester and an Application cannot assign or move (same refusals as the other Agent actions).
- [ ] Notice test: members of the new Team get the notice; the actor does not; on a Restricted ticket only Participants.
- [ ] Delivery test: the Event has `team` in `changed`, and `before`/`after` show the two Teams.
- [ ] REST test: the Team filter on the list returns only that Team's tickets, by the ticket's Team.
- [ ] MCP test: `assign_ticket` with an Agent's email assigns; with a Requester's email it is refused.
- [ ] Playwright flow: a Support Agent moves a ticket to Development and assigns it to a Development Agent; that Agent sees it under "Assigned to me".

## Blocked by

None. Builds on issues 05, 06, 08, 10, 14, 18, 20 and 27 (all done).
