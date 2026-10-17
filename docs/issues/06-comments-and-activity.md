# 06 · Public and Internal Comments, Activity, and Revert

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Agents and Requesters talk on the ticket, and every change is visible and reversible.

- Comments are Public or Internal. Requesters can write only Public Comments and never see Internal ones. An Agent's reply box defaults to Internal and changes color and text in Public mode, as on the design canvas.
- The append-only **audit log** records every action with Principal, channel, and change. It keeps facts, not personal values that Erasure must remove later (store values in a way that Erasure can clear them).
- **Activity** on the ticket is the audit log filtered to that ticket, mixed with the comments in time order.
- Revert on a reversible entry (Status, Priority, assignee, Field value) creates a new change. It never deletes history.

## Acceptance criteria

- [ ] REST test: a Requester cannot list or read Internal Comments on their own ticket.
- [ ] REST test: an Agent comment without a visibility value is Internal.
- [ ] REST test: each change (Status, Priority, assignee, Field value, comment) adds one audit entry with Principal and channel.
- [ ] REST test: Revert restores the previous value and adds a new audit entry.
- [ ] Playwright flow: an Agent sends a public reply, and the Requester sees it. An internal note stays hidden from the Requester.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
