# 10 · Search, filters, and similar tickets

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

People find tickets quickly and avoid duplicates.

- Search by title, description, and Ticket Reference (`LIKE`, no FTS5, because FTS5 breaks `wrangler d1 export`).
- Filters on the agent list: Ticket Type, Priority, assignee, and Field values (for example Branch), queried by Field Key across Schema Versions.
- Cursor pagination on list endpoints.
- In the web "New ticket" form, similar open tickets that this User can see show below the title while they type.
- Search results always respect the policy function.

## Acceptance criteria

- [ ] REST test: search finds a ticket by a word in the title, by a word in the description, and by its reference with any earlier prefix.
- [ ] REST test: a Field filter (Branch = Singapore) finds tickets on different Schema Versions.
- [ ] REST test: a Requester's search never returns tickets that the Requester cannot read.
- [ ] REST test: pagination returns every ticket once across pages.
- [ ] Playwright flow: typing a title that matches an open bug shows it under the title.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
