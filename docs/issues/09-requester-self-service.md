# 09 · Requester self-service: edit, cancel, reopen

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Requesters can correct, cancel, and reopen their own tickets inside clear limits.

- Edit the description and Field values only while the Status Category is `open`. After that, only comments.
- Cancel at any time before `done`. The ticket closes with the reason "cancelled by requester".
- Reopen a `resolved` ticket within 14 days. After 14 days, "reopen" creates a new ticket that links to the old one.
- The web ticket screen for a Requester shows only the actions that are allowed now.

## Acceptance criteria

- [ ] REST test: edit succeeds while `open` and is refused after an Agent moves the ticket to `in_progress`.
- [ ] REST test: cancel sets `closed` with the reason, and is refused when already `done`.
- [ ] REST test: reopen within 14 days returns the ticket to `open`. After 14 days it creates a linked new ticket.
- [ ] REST test: a Requester cannot edit, cancel, or reopen another person's ticket.
- [ ] Each action adds an audit entry.

## Blocked by

- [06 · Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md)
