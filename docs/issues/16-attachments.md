# 16 · Attachments

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

People and Applications attach files to tickets, and only people who can see the ticket can download them.

- Upload: a raw streamed body to the ticket's attachments endpoint, with the filename in a header and a required `Content-Length`. The body streams to the private R2 bucket without parsing. Limit 25 MB.
- Download: only through the Worker, with the same policy check as the ticket, served with `Content-Disposition: attachment`.
- A "file" Field stores attachment references.
- The web form and the reply box upload with the same endpoint.

## Acceptance criteria

- [ ] REST test: an upload without `Content-Length` or above 25 MB is refused with a clear error.
- [ ] REST test: a User who cannot read the ticket cannot download its file.
- [ ] REST test: every download has `Content-Disposition: attachment`.
- [ ] REST test: an Application can upload to its own ticket only.
- [ ] The CPU budget check (issue 02) covers a 25 MB upload.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
