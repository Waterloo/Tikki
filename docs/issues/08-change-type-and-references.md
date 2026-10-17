# 08 · Change Ticket Type, change prefix, and reference lookup

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Agents fix a wrong Ticket Type, and every old reference keeps working.

- An Agent changes a ticket's type. The ticket moves to the new type's newest Schema Version. Values with matching Field Keys move. Other values stay visible in the Activity. The Team changes to the new type's Team.
- The number stays and only the prefix changes (`BUG-1048` becomes `PAY-1048`).
- Lookup by Ticket Reference uses only the number, so any earlier prefix still opens the ticket in search, links, REST, and MCP.
- An Admin can change a type's prefix. Old references still resolve.
- MCP tool for Agents: change Ticket Type.

## Acceptance criteria

- [x] REST test: a type change keeps the number, moves matching values, and records the others in the audit entry.
  - Evidence: `test/worker/change-type.test.ts` > "keeps the number, moves matching values..." (also checks the Team changes and the Activity shows the unmoved values).
- [x] REST test: `BUG-1048` and `PAY-1048` both return the same ticket after the change.
  - Evidence: "resolves the old and the new reference..." (REST, search `q=`, a bare number, lower case, and MCP `change_ticket_type`).
- [x] REST test: after a prefix change, the old prefix still resolves.
  - Evidence: `change prefix` > "keeps the old prefix working and reserved".
- [x] REST test: a Requester cannot change the type.
  - Evidence: "refuses a Requester..." (403 for own ticket, 404 for an unreadable one, no `change_type` in `allowed_actions`).
- [x] Playwright flow: an Agent changes Bug to Payment issue, and the header shows the new reference.
  - Evidence: `e2e/change-type.spec.ts`.

## Blocked by

- [07 · Admin creates and edits Ticket Types and Fields](07-admin-ticket-types-and-fields.md)

## Evidence

- `pnpm test`: 18 files, 183 tests pass (8 new in `test/worker/change-type.test.ts`; `mcp.test.ts` and `roles.test.ts` lists updated). `pnpm typecheck` passes. `E2E_PORT=8831 pnpm e2e`: 13 pass.

## Not verified

- The "Change type" panel was not opened in a browser by hand: not checked against the canvas in dark mode or at 375 px. Playwright covers the flow only.
- Prefix reuse by a second type after the owner takes its prefix back is not tested beyond the owner case.

## Decisions made here

- **Route.** `PUT /api/v1/tickets/{ref}/type` with `{ ticket_type_id }`, Agent and Admin only. Policy action `change_type` (new, in `policy.ts`, listed in `allowed_actions`). Code is in `server/utils/ticket-type-change.ts`; it goes through `applyChange` (one batch, one audit entry).
- **Refused targets** (422 on `ticket_type_id`): unknown, archived, or the ticket's current type.
- **Audit.** Action `type_changed`. `before` = `{ type, ref, unmoved: [{ key, label, value }] }`, `after` = `{ type, ref }`. All of it is in `before`/`after`, so Erasure clears it; an erased entry still shows "changed the Ticket Type". Labels are stored in the entry, so it reads without the old Schema Version.
- **Not reversible.** The old Schema Version, Team and dropped values may have changed, and Erasure can clear the values. `type_changed` is not in `REVERSIBLE`; the revert route answers 409 `NOT_REVERSIBLE`. To go back, change the type again (values that did not move stay in the Activity only).
- **What moves.** A value moves when the new type's newest version has a non-archived Field with the same key and the same data type. For select Fields every value must also be a known option of the new Field (archived options count). Otherwise it does not move.
- **Required Field of the new type with no value:** the change is allowed and the Field stays empty. The ticket was made under the old rules, and an Agent fills it later.
- **"file" values** that move keep their attachment: attachments belong to the ticket number, which does not change. A file value that does not move leaves the file in the ticket's Attachments list.
- **Status and assignee** do not change. Team and visibility come from the new type.
- **Reference lookup** already used only the number (`parseTicketReference`). Checked in REST routes (`routeTicketNumber`), MCP (`change` helper), upload route, search (`q`), and the web page (it replaces the address with the current reference). Any prefix, even one the ticket never had, opens the ticket (4.9a).
- **Prefix change** was already allowed by `PATCH /api/v1/ticket-types/{id}` (issue 07). New: a replaced prefix stays reserved. Table `ticket_type_old_prefix` (migration `0008_issue_08_old_prefix.sql`) is filled in the same batch as the prefix change. Another type cannot take it (422 "stays reserved"); the owner may take it back. Reason: an old reference in an email must never read as another type.
- **MCP** `change_ticket_type { ticket, ticket_type_id }`, same annotations as `change_status`. Added last in the tool list; `change()` in `mcp.ts` takes an optional runner.
- **UI.** In the ticket properties, "Change type" (Agents and Admins) opens an inline select with a note and Change type / Cancel, instead of a modal (no modal exists in the app yet). The Activity line reads "changed the Ticket Type from Bug (BUG-1) to Payment issue (PAY-1)" with a "Did not move: ..." line.

## Glossary terms to add

- **Replaced prefix**: a prefix that a Ticket Type had before an Admin changed it. It stays reserved. Old references with it still open the ticket, because lookup uses only the number.

## Notes for later issues

- **Webhooks (14, 15):** a type change is a `ticket.updated`-like event; the payload should carry both refs. The audit entry `type_changed` has them.
- **Erasure (22):** the type change entry keeps `before` and `after` in JSON; clear both to NULL. `listActivity` already handles it.
- **Issue 09 (Requester edits):** `change_type` is Agent-only in `AGENT_ONLY`; nothing for a Requester to add.
- **Workflows/Statuses:** a type change does not touch Status. If Workflows become per type, this needs a rule.
- Files outside this issue's area: `server/utils/policy.ts` (new action), `server/utils/activity.ts` (`unmoved`, type text), `server/utils/mcp.ts` (one tool), `server/utils/ticket-type-admin.ts` (old prefix), `app/pages/tickets/[ref].vue`, `app/components/TicketConversation.vue`, `app/types/tickets.ts`, `test/worker/mcp.test.ts`, `test/worker/roles.test.ts` (action lists).
