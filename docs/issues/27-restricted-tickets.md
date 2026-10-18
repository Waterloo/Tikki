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

- [ ] REST test: an Agent who is not a Participant gets NOT_FOUND for a Restricted ticket on read, list, search, similar tickets, comments, Activity and attachment download. The counts leave it out.
- [ ] REST test: the Requester, the assignee, an added Participant and an Admin can read it. A removed Participant cannot.
- [ ] REST test: only the Requester, the assignee and Admins can add or remove Participants. Each change writes an audit entry.
- [ ] MCP test: `get_ticket`, `search_tickets` and `list_my_tickets` follow the same rule.
- [ ] Notice test: "ticket created" and comment notices for a Restricted ticket go only to Participants.
- [ ] Delivery test: an Admin endpoint without "include internal data" gets no Event for a Restricted ticket. One with it gets the Event.
- [ ] REST test: an Application cannot create a ticket of a Restricted type, and such a type is not in its allowed list.
- [ ] Playwright flow: an Agent raises a data request, adds a second Agent as Participant; a third Agent cannot open it.

## Blocked by

None. Builds on issues 05, 06, 12, 14, 18 and 20 (all done).
