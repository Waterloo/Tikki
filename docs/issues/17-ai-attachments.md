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

- [ ] MCP test: `attach_text` above the size limit returns a clear error. Within the limit, the file can be downloaded.
- [ ] REST test: an Upload Link works once, fails after 15 minutes, and fails for a different User's session or without a session.
- [ ] MCP test: a Requester cannot request a link for another person's ticket.
- [ ] Playwright flow: open the link while signed in, upload a PNG, see it on the ticket.

## Blocked by

- [11 · Claude: follow-up for Requesters and tools for Agents](11-claude-follow-up-and-agent-tools.md)
- [16 · Attachments](16-attachments.md)
