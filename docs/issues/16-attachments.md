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

- [x] REST test: an upload without `Content-Length` or above 25 MB is refused with a clear error.
  Evidence: `test/worker/attachments.test.ts`, "refuses an upload without Content-Length" (411 `LENGTH_REQUIRED`) and "refuses a file above 25 MB and accepts one of exactly 25 MB" (413 `FILE_TOO_LARGE`). The checks read only headers, so a refused upload reads no body. Also refused: no file name, empty file, and a body shorter than the declared length (400 `UPLOAD_INCOMPLETE`, nothing stored).
- [x] REST test: a User who cannot read the ticket cannot download its file.
  Evidence: "hides the files of a ticket from a User who cannot read it...": download, list, and upload all answer 404 `NOT_FOUND`, the same as for an ID that does not exist. An Agent can download. "lets a Requester read a file of a "visible to all" ticket" covers the other side of the same rule.
- [x] REST test: every download has `Content-Disposition: attachment`.
  Evidence: "serves every download as an attachment with nosniff, and never as script": HTML, SVG, PNG, and an invalid type all get `attachment`, `nosniff`, and `no-store`. HTML, SVG, and unknown types are served as `application/octet-stream`.
- [ ] REST test: an Application can upload to its own ticket only.
  Not done: Applications come with issue 12. `authorizeAttach` in `policy.ts` equals the read rule, so issue 12 adds the Application principal to `canRead` ("only the tickets it created") and this criterion follows. Then add the test.
- [ ] The CPU budget check (issue 02) covers a 25 MB upload.
  Pending: issue 02 is not built. The upload path was made for it: no body read, no parsing, one R2 `put`, one D1 insert. A 25 MB upload and download ran against `wrangler dev` (not timed for CPU).

Other criteria in "What to build":
- [x] Raw streamed upload, filename in a header, R2 binding in the vitest Worker config. Evidence: all tests in `test/worker/attachments.test.ts` run against the built Worker with local R2 (`FILES` comes from `wrangler.jsonc`, which the vitest plugin reads).
- [x] A "file" Field stores attachment references. Evidence: "belong to the uploader alone, and a file Field can claim them on a new ticket" (a stranger's ID, an unknown ID, a used ID, and a non-text value are all refused with a Field error).
- [x] The web form uploads with the same endpoint. Evidence: `e2e/attachments.spec.ts` (upload in New ticket, create, download from the ticket; 25 MB limit message; attach on the ticket page). The reply box is issue 06.

## Not verified

- CPU time of a 25 MB upload and download on Workers Free (issue 02).
- The R2 bucket on a real Cloudflare account: only the local simulation ran. The staging bucket `ticketing-files-staging` must be created before the first deploy.
- Drag and drop onto the file Field in the New ticket form was not tried (the click path and the file input were).
- Light and dark mode and 375 px were checked in the browser for the ticket page and the form (no horizontal scroll). Empty, loading, and error states of the attachments list were not all seen: the empty state is in the e2e test; loading and error were not forced.

## Decisions made here

- **The Worker entry is ours.** Nitro's Cloudflare entry copies every request body into memory (`Buffer.from(await request.arrayBuffer())`) before any route runs. That breaks "stream, no buffering" and the 128 MB limit. `server/entry.ts` wraps the standard Nitro entry and handles `PUT /api/v1/tickets/{ref}/attachments` and `PUT /api/v1/attachments` first (`server/utils/upload.ts`). It is set with `nitro.entry` in `nuxt.config.ts`; the prerender step drops it (it runs on Node). Every other route is unchanged. Do not add a Nitro route for an upload: it would buffer.
- **Uploads before the ticket exists:** `PUT /api/v1/attachments` stores an unattached file (`attachment.ticket_number` is null). Only its uploader can read it. A "file" Field on a new ticket may name it; `createTicket` attaches it in the same `db.batch` as the ticket insert (`last_insert_rowid()`). Rule for a Field value: a file of the same ticket, or an unattached upload of the same User. Anything else (unknown, or another person's) gets the same Field error. A file already attached to a ticket cannot go on another.
- Download: `GET /api/v1/attachments/{id}`. Attached: the read rule of its ticket (`authorizeAttachmentRead`). Unattached: its uploader only, staff included. Refusal is 404 `No attachment with this ID.` List: `GET /api/v1/tickets/{ref}/attachments`.
- Upload headers: `Content-Length` (required, 1 byte to 25 MiB; 411, 413, 422), `X-Filename` (percent-encoded UTF-8, `/`, `\` and control characters become `_`, 200 characters), `Content-Type` (kept if it is a well-formed `type/subtype`, else `application/octet-stream`). R2 gets the body stream; the stored size must equal the declared size, or the object is deleted.
- Safe content type: only images (PNG, JPEG, GIF, WebP), PDF, plain text, CSV, JSON, ZIP, and the three Office types are served with their own type. Everything else, HTML and SVG included, is `application/octet-stream`. All downloads also carry `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Cache-Control: private, no-store`.
- Policy: `authorizeAttach` (add a file to a ticket) equals the read rule, so everyone who can see a ticket can attach to it, a Requester included. No new Role rule.
- The R2 bucket binding is `FILES`: `ticketing-files-dev` at the top level, `ticketing-files-staging` in `env.staging`.
- Not done on purpose: delete an attachment, a limit for the number or total size of files per ticket, cleanup of unattached uploads, and range requests. See "Notes for later issues".

## Glossary terms to add

- **Unattached upload**: a file that a User uploaded before its ticket exists. Only the uploader can read it, until a new ticket claims it through a "file" Field.

## Notes for later issues

- **Issue 06 (reply box):** upload with `uploadFile(file, ticketRef)` from `app/composables/useUpload.ts`, then show `AttachmentChip`. It adds files to the ticket (they show in the Attachments section), but a comment does not point to them yet. If a comment must list its own files, add a nullable `comment_id` to `attachment` (a new column in issue 06's migration) and set it in the comment's `db.batch`; for a reply that uploads first, use an unattached upload and claim it with the same `last_insert_rowid()` batch as `createTicket` does (`claimUploads` in `server/utils/attachments.ts`). Add the activity entry for "file attached" in the upload route (`storeUpload`).
- **Issue 12 (Applications):** add the Application principal to `canRead` in `policy.ts` ("only the tickets it created"). Upload, list, and download then follow, because `authorizeAttach` and `authorizeAttachmentRead` call `canRead`. `server/utils/upload.ts` gets the Principal from `restPrincipal`, so API keys work there once `restPrincipal` reads them. An Application cannot make an unattached upload yet if the owner wants that: today any signed-in Principal can. Then write the missing test ("an Application can upload to its own ticket only").
- **Issue 17 (AI attachments):** MCP tools call `storeUpload`-like logic with a body in memory (text up to 256 KB); `R2.put` accepts a string. The Upload Link can reuse `PUT /api/v1/tickets/{ref}/attachments` with a one-time token instead of the session.
- **Issue 22 (erasure) and 24 (baseline):** unattached uploads that no ticket claims stay in R2 and D1 forever. A cleanup (older than 24 hours, `ticket_number IS NULL`) belongs in a Cron Trigger. Erasure must delete the R2 objects of a Contact's tickets (`attachment.id` is the R2 key).
- **Issue 02 (CPU check):** include `PUT` of 25 MB and `GET` of it. CPU in the route is one session lookup, one policy query, one R2 put, and one insert.
- **Issue 07 (type editor):** a "file" Field holds one attachment ID. Multiple files per Field are not supported.
- **Issue 24 / deploy:** create the staging bucket (`wrangler r2 bucket create ticketing-files-staging`) before the first deploy of this branch; CI does not create it.
- Any new Nitro-route upload or large raw body must go through `server/entry.ts`, for the buffering reason above.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
