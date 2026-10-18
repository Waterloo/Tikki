# 22 · Soft delete and Erasure

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Admins clean up mistakes reversibly, and personal data can be erased when the law requires it.

- Soft delete: an Admin hides a ticket everywhere (lists, search, MCP, REST, webhooks) and can restore it.
- Erasure, from Settings › Privacy (search by email or external ID) or `DELETE /api/v1/contacts/{id}` by the owning Application:
  - The Contact's name and email become `[erased]`.
  - The free text, Field values, and Attachments of the Contact's tickets are removed. The tickets stay.
  - Their audit entries lose their values but keep who, what, and when.
  - Outbox rows and deliveries that contain the Contact's data are purged.
- Delivered outbox payloads are purged after 30 days by the scheduled handler.

## Acceptance criteria

- [x] REST test: a soft-deleted ticket is invisible to every channel and visible again after restore. `test/worker/privacy.test.ts` "hides a deleted ticket from every channel, and shows it again after restore": for a Requester, an Agent and the Admin, detail, comments, activity, attachments list, file download, search (`?q=`), counts, similar tickets; the Application's detail and list; the Inbox and its unread count; MCP `get_ticket` and `search_tickets`; changes (PATCH, comment, upload, cancel, Application comment) answer 404 `NOT_FOUND`; no outbox Event is written. After restore every check is reversed, the audit has `ticket_deleted` and `ticket_restored`, and the next change writes an Event again. e2e `e2e/privacy.spec.ts` deletes from the ticket page and restores from Settings.
- [x] REST test: after Erasure, no API response, stored audit value, outbox row, or R2 object contains the Contact's name, email, or ticket text. Same file, "leaves no name, email or ticket text in any API answer, database row or R2 object": `databaseHits` reads `sqlite_master` and scans every column of every table (cast to text, case-insensitive), so a table added later is covered; `bucketHits` lists and reads every R2 object. The data was in the Contact, two tickets (title, description, Field value, Idempotency-Key), a Public and an Internal Comment, a PATCH (audit values), an attachment (file name and body), an Upload Link, notices and outbox Events with deliveries. The scan finds it before and nothing after; another Contact's data stays. API answers of 30+ routes (Admin, Agent, Application) are checked too.
- [x] REST test: the tickets still exist with their numbers, Statuses, and audit facts. Same test: number, reference and Status `in_progress` stay; every audit row keeps its id, ticket, principal, application, channel, action, Field key and comment id; `before`/`after` are NULL; one `ticket_erased` entry per ticket.
- [x] REST test: an Application can erase only its own Contacts. "lets an Application erase only its own Contacts, and an Admin any Contact": another Application 404, unknown and bad IDs 404, Agent and Requester 403, no session 401, the data is unchanged; the Admin finds the Contact by email (any case) and erases it.
- [x] Scheduled-handler test with a test clock: payloads older than 30 days are purged. Already built and tested by issue 14: `test/worker/webhooks.test.ts` "purges Events and deliveries after 30 days" runs the built Worker's `scheduled` handler with `scheduledTime` at +29 days (kept) and +31 days (Event and delivered delivery gone). No change was needed.
- [x] Extra: an R2 failure in Erasure leaves no reachable data, and a second call finishes (`vi.spyOn(env.FILES, 'delete')` rejects once: 500, the file answers 404 and is not listed, the DB scan is clean; the second DELETE answers 204 and the object is gone).

Counts at commit: `pnpm test` 329 tests in 27 files pass; `pnpm typecheck` passes; `E2E_PORT=8853 pnpm e2e` 25 passed.

## Not verified

- The Settings › Privacy screen and the ticket Delete button were not looked at in a browser by the agent (the sign-in in the browser pane was refused). The e2e specs drive both, in light mode at desktop width, and check no horizontal scroll at 375 px on Settings. Dark mode was not seen; the screen uses only the CSS tokens and existing components.
- No canvas screen exists for Settings › Privacy; it follows the existing Settings page.

## Decisions made here

1. **One read rule.** `PolicyTicket.deleted` and `canRead` return false for a deleted ticket, for every Principal, Admins included. `readableTickets` always adds `ticket.deleted_at IS NULL` (it no longer returns `undefined` for staff). So every channel that uses them (REST, MCP, Application reads, search, counts, similar, attachments, upload links) follows. The two places that build `PolicyTicket` (`policyFacts` in `tickets.ts`, `policyTicket` in `attachments.ts`) read `ticket.deleted_at`.
2. **Everything except restore answers NOT_FOUND** on a deleted ticket, also for Admins. No change can happen, so no Event, notice or email is written for it. Admins see deleted tickets only in Settings › Privacy (`GET /api/v1/tickets/deleted`, newest 200, with who deleted it from the audit log), not on the ticket page. Simplest, and `canRead` keeps matching `readableTickets` exactly.
3. **Delete** is the ticket action `delete` (Admins only, in `allowed_actions`; 403 for others who can read). `DELETE /api/v1/tickets/{ref}` answers 204. **Restore** is `POST /api/v1/tickets/{ref}/restore` (answers the ticket) through `authorizeRestore`: Admins only, 404 for everyone else and for a ticket that is not deleted. Both write an audit entry without values (`ticket_deleted`, `ticket_restored`); neither writes an outbox Event. `updated_at` does not change.
4. **Notices of a deleted ticket** are hidden in the Inbox and the unread count (`mine` in `notifications.ts`), and come back on restore. Pending webhook deliveries of earlier Events are still sent: they describe changes made before the delete.
5. **Not filtered:** the Admin's Ticket Type ticket counts and the Applications list ticket count still count deleted tickets (they describe what uses the type or came from the Application). Erasure also applies to deleted tickets.
6. **Erasure scope (Contacts only).** DECISIONS 9.2 is about Contacts. An internal User is not erased: the search answers `users` for a User's email and the page says to manage the person in People (deactivate). Users have accounts, sessions and an audit trail as staff; their removal is a separate decision.
7. **Who may erase.** `authorizeErasure`: an Admin (from Settings, through the same `DELETE /api/v1/contacts/{id}`), or the owning Application without a special permission (a data request is its right). Another Application gets 404 `NOT_FOUND` (no probing); a non-Admin User 403. The Admin search is `GET /api/v1/contacts?email=|external_id=` (exact; email ignores case; at most 50; Admins only).
8. **What Erasure changes**, in one `db.batch`: Contact name and email `[erased]`, external ID `[erased]:<id>` (it may be personal, and a later ticket with the old ID must make a new Contact instead of joining the erased tickets), `contact.erased_at`; ticket title `[erased]`, description empty, Field values `{}`; comment bodies `[erased]`; `audit_log.before/after` NULL; attachment file name empty and `attachment.erased_at`; Upload Links, Idempotency-Key rows (their hash is of the Contact's data), notices with their `notification_mail` rows, outbox Events with their deliveries (pending ones too) of these tickets are deleted; one `ticket_erased` audit entry per ticket (the Admin or the Application as Principal). Kept: tickets, numbers, Statuses, Priority, assignee, type, times, every audit fact.
9. **Order with R2.** D1 first, then R2. The batch marks the files erased, and downloads and lists refuse an erased attachment, so a file left in R2 after a failure is unreachable. The R2 delete then removes every erased file of the Contact's tickets (1000 keys per call). Erasure is idempotent: a second call answers 204 and deletes what is left. The Settings page tells the Admin to run it again when it fails.
10. **No Event for Erasure.** Receivers already got the old payloads; sending a new one would only say that data was erased. Delivered emails cannot be recalled; Contacts never get email.
11. **30-day purge (9.3)** is issue 14's `purge` in the Cron run; it is tested there and needed no change.
12. Migration `0017_issue_22_soft_delete_and_erasure.sql` (renumbered at merge): `ticket.deleted_at`, `contact.erased_at`, `attachment.erased_at`, plain `ALTER TABLE ADD` (no table rebuild). Audit actions `ticket_deleted`, `ticket_restored`, `ticket_erased` are TypeScript enum values only.
13. **OpenAPI** documents `DELETE /api/v1/contacts/{id}` for Applications. The other new routes are Admin routes and are not in it.

Copied to DECISIONS.md (rows 4.40, 4.41, 9.7 to 9.11; changed row 4.24).

## Notes for later issues

- Any new table or column that holds ticket text or Contact data must be cleared in `eraseContact` (`server/utils/privacy.ts`). The test `databaseHits` scans every table, so a new table with such data fails the Erasure test until it is handled.
- Any new query that lists tickets must use `readableTickets`, or add `ticket.deleted_at IS NULL` itself. Any new code that builds a `PolicyTicket` must set `deleted`.
- Issue 13 (Application actions): cancel and reopen go through `loadFor`, so a deleted ticket already answers 404.
- Issue 15 (Application webhooks): Erasure deletes the Contact's outbox Events and deliveries by `outbox_event.ticket_number`; an endpoint owned by the Application loses its pending deliveries for those tickets too. Decide if the Application needs a `contact.erased` Event; today none is sent.
- Issue 23 (rate limits): `DELETE /api/v1/contacts/{id}` does about 15 D1 statements in one batch plus one R2 call; limit it like other writes.
- Issue 24 (baseline): unattached uploads and used Upload Links still stay forever (issues 16 and 17 notes); Erasure removes only those of the Contact's tickets.
- Settings › Privacy has no canvas screen. If a design comes, `app/components/SettingsPrivacy.vue` holds both parts.

## Glossary terms to add

- **Soft delete**: an Admin hides a ticket from every channel. It can be restored. _Avoid_: archive, trash.

Copied to CONTEXT.md.

## Blocked by

- [12 · Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md)
- [14 · Outbox and admin Webhook Endpoints](14-outbox-and-admin-webhooks.md)
