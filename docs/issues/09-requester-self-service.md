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

- [x] REST test: edit succeeds while `open` and is refused after an Agent moves the ticket to `in_progress`.
  Evidence: `test/worker/self-service.test.ts`, "edits the description and a Field while open, and refuses it after an Agent moves the ticket on" (403 `FORBIDDEN` for description and Field), "allows an edit only in the open Category" (waiting refuses, back to open allows), "refuses status, priority and assignee from a Requester".
- [x] REST test: cancel sets `closed` with the reason, and is refused when already `done`.
  Evidence: "closes the ticket with the reason and writes audit entries" (Status `closed`, Public Comment "Ticket cancelled by requester.", `ticket_cancelled` entry) and "is refused when the ticket is already done" (resolved and closed: 403, and a second cancel: 403).
- [x] REST test: reopen within 14 days returns the ticket to `open`. After 14 days it creates a linked new ticket.
  Evidence: "returns the ticket to open within 14 days" (200, same ref), "creates a linked new ticket after 14 days and leaves the old one resolved" (201, `reopened_from`), "uses the test clock" (`reopenTicket(..., now)`: exactly 14 days is inside, +1 ms is outside), "counts from the latest resolution", "is refused for a ticket that is not resolved".
- [x] REST test: a Requester cannot edit, cancel, or reopen another person's ticket.
  Evidence: "answers 404 on a private ticket and 403 on a visible one" (a ticket of a type visible to all is readable but not changeable), "does not let an Agent cancel or reopen for the Requester".
- [x] Each action adds an audit entry.
  Evidence: "writes one audit entry for each edit" (`description_changed`, `field_changed`), cancel (`ticket_cancelled`, `comment_added`), reopen (`ticket_reopened`; `ticket_created` plus `ticket_reopened` on the old ticket after 14 days).
- [x] The web ticket screen for a Requester shows only the actions that are allowed now.
  Evidence: `e2e/self-service.spec.ts` (Edit and Cancel on an open ticket; no Edit once in progress; Reopen only when resolved; no Status or Priority controls; after cancel no action but comments). The buttons read `allowed_actions`.

## Blocked by

- [06 · Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md)

## Not verified

- The screens were not looked at by eye. The shared browser pane switched to another agent's tab while I signed in, so I stopped. Only the Playwright flow ran them (no layout, dark mode or 375 px check of the Edit form, the Cancel dialog and the "Reopened from" line).
- Two actors at the same moment (a Requester cancels while an Agent resolves): the policy check and the write are separate, so the last write wins. Same as the Revert window in issue 06.
- MCP tools for edit, cancel and reopen: not added. They belong to issue 11. The rules are in `policy.ts`, so the tools will get the same refusals.
- The old ticket shows no link forward to the new ticket (only an Activity line). Only the new ticket has `reopened_from`.

## Decisions made here

1. **Policy.** `PolicyTicket` now carries `statusKey` and `statusCategory`. New actions `edit_description`, `cancel`, `reopen`. `edit_fields` and `edit_description`: Agent and Admin always; the Requester of the ticket only while the Status Category is `open` (4.20). `cancel`: only the Requester of the ticket, and not when the Category is `done` (4.21). `reopen`: only the Requester of the ticket, and only when the Status is `resolved` (4.22). An Agent who is not the Requester changes the Status instead. A closed ticket cannot be reopened. Order of `allowed_actions` follows `TICKET_ACTIONS`.
2. **Where the cancel reason is stored.** Two places, in one batch: a `ticket_cancelled` audit entry (before: old Status key, after: `closed`; the entry name is the reason, no personal data) and a Public Comment "Ticket cancelled by requester." from the Requester, so the Agent sees the reason in the conversation. Constant `CANCEL_REASON` in `server/utils/self-service.ts`. No free-text reason in v1.
3. **Reopen link shape.** A nullable column `ticket.reopened_from` (the old ticket number), not a link table: one reason, one direction. `TicketDetail.reopened_from` is `{ number, ref } | null`. The new ticket copies Ticket Type, Schema Version (so the Field values stay valid), title, description, priority and Fields; the Requester is the caller, Status `open`.
4. **The 14 days.** Counted from the latest `status_changed` entry whose value is `resolved` in the audit log, so a ticket that was resolved, reopened by an Agent and resolved again counts from the last time. 14 days exactly is inside. No new column. `reopenTicket(db, principal, number, now = new Date())` takes the clock; tests also age the audit rows.
5. **REST.** `PATCH /api/v1/tickets/{ref}` takes `description` (policy `edit_description`) next to `fields`. A missing `description` never clears it; an unchanged value writes no entry. `POST /api/v1/tickets/{ref}/cancel` returns the ticket. `POST /api/v1/tickets/{ref}/reopen` returns 200 with the same ticket, or 201 with the new one.
6. **Audit.** New actions `description_changed`, `ticket_cancelled`, `ticket_reopened` (TypeScript enum, no migration). They are not reversible. Activity shows no description text (values are null in the view). After 14 days: `ticket_created` on the new ticket (`after` = old number) and a `ticket_reopened` entry without values on the old one.
7. **`applyChange`** takes two optional arguments, extra batch statements and `now`, so cancel can write its comment in the same batch.
8. **Ticket view.** `schema_fields` now also has `required`, `help` and the active `options`, so the Requester can edit the Fields. The Edit form shows for anyone with `edit_description` or `edit_fields` (so Agents too).
9. **Old tests changed:** the Requester now has `['edit_fields', 'edit_description', 'comment', 'cancel']` on an open own ticket; the "Field edit from a Requester" refusal test now moves the ticket to `in_progress` first.

Copied to DECISIONS.md (rows 4.34 to 4.36).

## Glossary terms to add

- **Cancel**: the Requester closes their own ticket before it is done. Status `closed`, reason "cancelled by requester".
- **Reopen**: the Requester returns a `resolved` ticket to `open` within 14 days of the resolution. After that, a new ticket is created that links to the old one (`reopened_from`).

Copied to CONTEXT.md.

## Notes for later issues

- Issue 11 (MCP): add tools that call `cancelTicket` and `reopenTicket` from `server/utils/self-service.ts`, and let `update_ticket` style tools send `description`. Map `ticketError` as REST does.
- Issue 14 and 15 (webhooks): a cancel emits a status change to `closed` and a Public Comment; `ticket_reopened` is a status change to `open`, or a new ticket (`ticket.created`) after 14 days.
- Issue 12 (Application as Principal, 4.23): the rules use `requesterId === principal.userId`. For a Contact's ticket the owner check must also accept the Application.
- Issue 22 (Erasure): `description_changed` entries hold the old and new description in `before` and `after`; clearing those columns is enough.
- Migration `0006_issue_09_reopened_from.sql` adds only `ticket.reopened_from`. The lead renumbers.
