# 08 · Change Ticket Type, change prefix, and reference lookup

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Agents fix a wrong Ticket Type, and every old reference keeps working.

- An Agent changes a ticket's type. The ticket moves to the new type's newest Schema Version. Values with matching Field Keys move. Other values stay visible in the Activity. The Team changes to the new type's Team.
- The number stays and only the prefix changes (`BUG-1048` becomes `PAY-1048`).
- Lookup by Ticket Reference uses only the number, so any earlier prefix still opens the ticket in search, links, REST, and MCP.
- An Admin can change a type's prefix. Old references still resolve.
- MCP tool for Agents: change Ticket Type.

## Acceptance criteria

- [ ] REST test: a type change keeps the number, moves matching values, and records the others in the audit entry.
- [ ] REST test: `BUG-1048` and `PAY-1048` both return the same ticket after the change.
- [ ] REST test: after a prefix change, the old prefix still resolves.
- [ ] REST test: a Requester cannot change the type.
- [ ] Playwright flow: an Agent changes Bug to Payment issue, and the header shows the new reference.

## Blocked by

- [07 · Admin creates and edits Ticket Types and Fields](07-admin-ticket-types-and-fields.md)
