# 30 · Claude checks for duplicates, and the Cron removes old uploads

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md), [feature review](../reviews/2026-10-18-feature-review.md) items 3 and 8

## What to build

Most tickets come through Claude, and Claude does not see the similar tickets that the web form shows. Unused uploads stay in R2 forever.

- **Duplicate check in `create_ticket`.** Before it creates a ticket, the tool looks for similar open tickets that the User can read, with the same function as the web form (issue 10). If it finds any, it creates nothing. It returns the matches (references, titles, Status, marked as untrusted content) and tells Claude to ask the User: add a comment to an existing ticket, or create a new one. Claude calls `create_ticket` again with `confirm_new: true` to create it anyway. Without matches, the tool creates the ticket at once, as today.
- **Upload cleanup in the Cron.** The scheduled run deletes unattached uploads (no ticket) older than 24 hours, the R2 object and its row, and Upload Links that are used or expired for more than 24 hours. Each run is bounded, like the outbox run.

## Acceptance criteria

- [ ] MCP test: with a similar open ticket, `create_ticket` creates nothing and returns the match; with `confirm_new: true` it creates the ticket.
- [ ] MCP test: a similar ticket that the User cannot read (another Requester's private ticket, a Restricted ticket, a deleted ticket) is never returned, and does not block the create.
- [ ] MCP test: a closed or resolved similar ticket does not block the create.
- [ ] Scheduled-handler test with a test clock: an unattached upload older than 24 hours is deleted from D1 and R2; a newer one and an attached one stay.
- [ ] Scheduled-handler test: used and expired Upload Links older than 24 hours are deleted; a valid one stays.

## Blocked by

None. Builds on issues 10, 11, 16, 17 and 22.
