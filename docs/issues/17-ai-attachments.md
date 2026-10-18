# 17 · AI attachments: inline text and Upload Links

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Claude can attach evidence even though it cannot send binary files.

- MCP tool `attach_text`: a filename and text content up to about 256 KB (logs, CSV, stack traces). It is stored as a normal Attachment.
- MCP tool `request_upload_link`: returns a link for one ticket. The link expires after 15 minutes, works once, and also requires the same User's web session. The link opens a small upload page.
- Both tools go through the policy function.

## Acceptance criteria

- [x] MCP test: `attach_text` above the size limit returns a clear error. Within the limit, the file can be downloaded.
  Evidence: `test/worker/ai-attachments.test.ts`, "stores text as a normal Attachment..." (download, `attachment` disposition, audit entry with channel `ai`) and "refuses text above 256 KB in UTF-8 bytes..." (`FILE_TOO_LARGE`; 131073 two-byte characters are refused, exactly 256 KB is accepted).
- [x] REST test: an Upload Link works once, fails after 15 minutes, and fails for a different User's session or without a session.
  Evidence: "Upload Link over REST": works once (second upload 410 `LINK_USED`, three parallel uploads give one 201), expiry with a fake `Date` (410 `LINK_EXPIRED` at 15 min + 1 s, still valid at 14 min), no session 401, another User's session 403 `LINK_WRONG_USER`, a failed upload frees the link, the policy is checked again at use.
- [x] MCP test: a Requester cannot request a link for another person's ticket.
  Evidence: "refuses a Requester for another person's ticket, with the same NOT_FOUND as REST" (no link row is written). Same for `attach_text`.
- [x] Playwright flow: open the link while signed in, upload a PNG, see it on the ticket.
  Evidence: `e2e/ai-attachments.spec.ts` (also: signed out, sign in, back to the link, upload).

## Blocked by

- [11 · Claude: follow-up for Requesters and tools for Agents](11-claude-follow-up-and-agent-tools.md)
- [16 · Attachments](16-attachments.md)

## Not verified

- A real upload of a large file through the link page (only a 1x1 PNG in e2e).
- The empty, loading, and ready states of the upload page in a browser, and the ready state at 375 px and in dark mode: only the "link cannot be used" state was seen at desktop light, and at 375 px dark. The others ran in Playwright, not looked at.
- Claude (the real connector) calling the two tools: tested with the MCP client only.
- CPU time of the link upload on Workers Free (issue 02): one session lookup, one link lookup, one policy query, one UPDATE, one R2 put, one batch.

## Decisions made here

- **Audit:** issue 06 had no attachment action. `attachment_added` is added to `AUDIT_ACTIONS` (no migration: the column is plain text). `putObject` in `server/utils/attachments.ts` writes it in the same `db.batch` as the attachment row, for REST uploads, `attach_text`, and the Upload Link. `after` holds the file name (Erasure clears it). An unattached upload (no ticket) has no entry. The activity feed shows "X attached name".
- **One write path:** `putObject` (R2 put, size check, row, audit) is used by `storeUpload` (REST, a stream), `attachText` (MCP, a string) and `uploadViaLink`.
- **`attach_text`:** size is counted in UTF-8 bytes (limit 262144); a larger text answers `FILE_TOO_LARGE` and points to `request_upload_link`. The caller never chooses the type: `text/csv` for a `.csv` name, else `text/plain`. They are stored without `charset`, because the download code compares the bare type with its safe list.
- **Upload Link:** table `upload_link` (hash of the token, ticket, User, `expires_at`, `used_at`). The token is 32 random bytes, shown once, stored as SHA-256 hex. The URL is `{APP_URL}/upload/{token}`.
- **Consumed on upload, not on page open.** The page only does `GET /api/v1/upload-links/{token}` (read, no change). `PUT /api/v1/upload-links/{token}` is handled in `server/entry.ts` through `handleUpload` (streamed, like issue 16). Order: check link and User and policy and headers, then claim the link with one conditional UPDATE (`used_at IS NULL AND expires_at > now AND user_id = me`) and check `meta.changes === 1`, then stream to R2. The claim before the body is the lock for parallel uploads. A failed upload gives the claim back (`used_at = NULL` where it still holds our timestamp), so the person can retry. A Worker that dies mid-upload leaves the link used: the safe side; ask for a new link.
- Refusals of the link are specific, because the token has 256 bits and cannot be guessed: 404 `LINK_NOT_FOUND`, 403 `LINK_WRONG_USER`, 410 `LINK_USED`, 410 `LINK_EXPIRED`. No session is 401, like all REST routes. The policy (`authorizeAttach`) runs again at use, so a User who lost the right gets NOT_FOUND.
- **Sign-in and back:** `auth.global.ts` sends a signed-out visitor to `/sign-in?redirect=<path>`; the sign-in page goes there after success (only a path on this site: a leading `/` not followed by `/` or `\`). Other pages get this for free.
- The upload page `/upload/[token]` uses the `auth` layout and the sign-in card style. No canvas screen exists.

Copied to DECISIONS.md (rows 2.11, 3.31, 5.14 to 5.16).

## Glossary terms to add

- **Upload Link**: a link that Claude gets for one ticket and one User. It expires after 15 minutes, works for one successful upload, and needs the web session of the same User. Only a hash of its token is stored.

Copied to CONTEXT.md.

## Notes for later issues

- Issue 22 (erasure) and 24 (baseline): expired and used `upload_link` rows stay forever. A Cron Trigger can delete rows older than a day. They hold no personal data besides the User and ticket IDs.
- Issue 12 (Applications): the link needs a web session, so an Application cannot use it. `attach_text` follows `authorizeAttach` for any new Principal.
- Any new MCP tool that throws `AttachmentError` is already mapped by `run()` in `mcp.ts`.
- Tests move the clock with `vi.useFakeTimers({ toFake: ['Date'] })`: the Worker and the test share one isolate, so the Worker sees it. Better-Auth's session lookup sees it too.
