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

- [x] MCP test: with a similar open ticket, `create_ticket` creates nothing and returns the match; with `confirm_new: true` it creates the ticket.
  - Evidence: `test/worker/duplicates.test.ts` 'creates nothing when a similar open ticket exists': first call returns `isError: false`, `created: false`, the match (ref, marked title, Status); with `confirm_new: true` the ticket is created (ticket count 1 then 2).
- [x] MCP test: a similar ticket that the User cannot read (another Requester's private ticket, a Restricted ticket, a deleted ticket) is never returned, and does not block the create.
  - Evidence: `duplicates.test.ts` 'never shows tickets the User cannot read': another Requester gets no match (private ticket); an Agent sees the private ticket but never the Restricted or deleted one; both calls still create.
- [x] MCP test: a closed or resolved similar ticket does not block the create.
  - Evidence: `duplicates.test.ts` 'is not blocked by a resolved or closed ticket'.
- [x] Scheduled-handler test with a test clock: an unattached upload older than 24 hours is deleted from D1 and R2; a newer one and an attached one stay.
  - Evidence: `duplicates.test.ts` 'deletes unattached uploads older than 24 hours': old row and R2 object gone (`FILES.head` null); 23-hour-old and attached ones stay. Also the R2-failure rerun test.
- [x] Scheduled-handler test: used and expired Upload Links older than 24 hours are deleted; a valid one stays.
  - Evidence: `duplicates.test.ts` 'deletes used and expired Upload Links': four old/new used/expired links, only the 25-hour ones go; the valid one stays.

## Blocked by

None. Builds on issues 10, 11, 16, 17 and 22.

## Verification

`pnpm test` 389 passed (33 files, 7 new), `pnpm typecheck` clean, `E2E_PORT=8911 pnpm e2e` 30 passed. No UI in this issue; no migration.

## Not verified

- A real Cron Trigger on Cloudflare (tests call `scheduled` on the built Worker).
- Claude's behaviour on the result text (only the tool output is tested).

## Decisions made here

- Duplicate check uses `similarTickets` with the title only (cheap, same as the web form). A blocked call returns `isError: false`, `structuredContent: { created: false, similar_tickets }`. It still counts as a write call in the rate limits.
- Upload cleanup order: (1) mark old unattached rows `erased_at`, (2) delete the R2 objects, (3) delete the rows. A failure in step 2 leaves marked rows, which nobody can claim or download; the next run finds marked rows first and finishes. Deleting R2 first could leave a claimable row without an object; deleting rows first would leave R2 objects that no rerun can find.
- To make the mark effective, `claimUploads` and `checkFileRefs` skip rows with `erased_at` set.
- Each run handles at most 100 files and 100 Upload Links. Upload Links are deleted when `used_at` or `expires_at` is more than 24 hours old.
- Cleanup runs after the outbox work and counter cleanup. If it throws, the run fails visibly in Cron logs.
- Erased attachments of tickets (issue 22) are unchanged; Erasure still deletes their objects on a rerun.

## Notes for later issues

- Cleanup code is `server/utils/cleanup.ts`, called from `server/plugins/outbox.ts`.
- An unattached upload is claimable only within 24 hours (plus up to one Cron interval).

## Glossary terms to add

None.
