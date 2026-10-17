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

- [ ] Policy tests through REST: a Requester cannot read another Requester's ticket of a private type, but can read one of a "visible to all" type.
- [ ] REST test: a Requester cannot change Status or assignee. An Agent can.
- [ ] REST and MCP return the same refusal for the same forbidden action.
- [ ] The list groups by Status and the three filters return the right tickets.
- [ ] Playwright flow: an Agent opens a ticket, selects "Assign to me", and changes Status.

## Blocked by

- [03 · Ticket Types with Fields](03-ticket-types-with-fields.md)
