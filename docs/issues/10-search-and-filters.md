# 10 · Search, filters, and similar tickets

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

People find tickets quickly and avoid duplicates.

- Search by title, description, and Ticket Reference (`LIKE`, no FTS5, because FTS5 breaks `wrangler d1 export`).
- Filters on the agent list: Ticket Type, Priority, assignee, and Field values (for example Branch), queried by Field Key across Schema Versions.
- Cursor pagination on list endpoints.
- In the web "New ticket" form, similar open tickets that this User can see show below the title while they type.
- Search results always respect the policy function.

## Acceptance criteria

- [x] REST test: search finds a ticket by a word in the title, by a word in the description, and by its reference with any earlier prefix.
  Evidence: `test/worker/search.test.ts`, "finds a ticket by a word in the title, a word in the description, and its reference with any prefix" (also: case-insensitive, every word must match) and "treats % and _ in the search as text".
- [x] REST test: a Field filter (Branch = Singapore) finds tickets on different Schema Versions.
  Evidence: `test/worker/search.test.ts`, "filters by a Field Key across Schema Versions". The test makes a type with a Branch Field, creates a ticket on version 1, adds version 2 (the Field label changes), creates a ticket on version 2, and `field=branch:Singapore` returns both. It also covers a multi-select item match and a quote in the value.
- [x] REST test: a Requester's search never returns tickets that the Requester cannot read.
  Evidence: `test/worker/search.test.ts`, "never returns tickets that the Requester cannot read, whatever the search or filter" (search by word, by reference, by number, with Type, Field, assignee, and Priority filters, and the counts). Also for similar tickets: "shows a Requester only tickets that the Requester can read".
- [x] REST test: pagination returns every ticket once across pages.
  Evidence: `test/worker/search.test.ts`, "returns every ticket once across pages, in Status order, with counts for all pages" (7 tickets, two Statuses, two tickets with the same update time, 4 pages of 2, same order as the unpaged list).
- [x] Playwright flow: typing a title that matches an open bug shows it under the title.
  Evidence: `e2e/new-ticket.spec.ts`, "typing a title that matches an open bug shows it under the title".

Checked by hand in the browser against `wrangler dev` (2026-10-18), with 56 tickets and a Branch Field on a type with two Schema Versions:
- All tickets: search `100%` found the 55 tickets with a literal `%` (the `x` ticket did not match), 50 showed with "Load more", and one click showed all 55. The Type, Priority and Branch menus filter, the address keeps the filters, and "No tickets match" with "Clear search and filters" shows when nothing matches.
- At 375 px the list page has no horizontal scroll (`scrollWidth` 375). Dark mode looks right. Light mode was seen at desktop width.
- New ticket: typing a title shows "This may already be reported" with the matching tickets under the title, in dark mode at 375 px.

## Not verified

- The list error state and the "Load more" failure message were not forced in the browser.
- The new-ticket similar box was not seen in light mode at 375 px, or at desktop width in dark mode.
- Branch as a Field is not seeded (no seeded type has it), so the filter shows only when some Ticket Type has a Field with the key `branch`. I added one to a local type to see it.
- Speed with a large table (10,000+ tickets) was not measured. `LIKE '%word%'` scans the table by design (no FTS5); the list filters by Status, Type, and assignee use the new indexes.

## Decisions made here

- **Cursor.** The cursor is the sort key of the last row: Status position, update time (ms), and number, as base64 JSON. The list sorts by Status position, then newest update, then highest number, so the key is unique and a keyset condition (`position > p OR (position = p AND (updated < u OR (updated = u AND number < n)))`) gives each page. Offsets are not used, because a new ticket between two requests would shift every row. A ticket that changes Status or is updated between two page requests can move; the next full list shows it. A bad cursor answers 422 with key `cursor`.
- **Paging.** `limit` is 1 to 200, default 50. The response is `{ data, counts, next_cursor }`; `next_cursor` is null on the last page. One extra row is read to know whether another page exists. `counts` covers all pages of the active filters, so the group headers stay right while pages load.
- **The list UI.** Groups still show every Status. Pages arrive in Status order, so a later group can have a count and no rows yet; it says "N more below. Use Load more." The "Load more" button is under the last group.
- **Filters in REST.** `q`, `type` (Ticket Type ID), `priority`, `assignee` (`me`, `none`, or a User ID; before this issue only `me` and `none`, and any other value was a 422), `field=<key>:<value>` (repeat for more; every one must match), `open=true` (Status Category is not `done`), `requester=me`. All of them use the same query condition as the read rule of `policy.ts` (`readableTickets`).
- **Search.** The search text is split on spaces (at most 8 words, 200 characters). Every word must be in the title or the description (`LIKE`, case-insensitive for ASCII). `%`, `_`, and `\` in the input are escaped (`ESCAPE '\'`). A word that is a Ticket Reference (`BUG-12`, `PAY-12`, `12`) also matches the ticket with that number, whatever the prefix (4.9a). So `12` finds ticket 12 and any ticket with `12` in the text.
- **Field filter query.** Field values are one JSON object in `ticket.fields`, keyed by Field Key and not by Schema Version, so a filter by key works across versions with no join. The query is `json_extract(fields, '$."key"') = ?`, or, for a multi-select (an array), `EXISTS` over `json_each`. Both run in SQLite with bound values. The key is limited to `[\w-]{1,64}` so it cannot break the JSON path. The value is compared as text: a `number` or `checkbox` Field matches `5` but a checkbox value is stored as `true`, which the filter does not match. No UI filter uses those types yet.
- **Indexes (migration `0004_issue_10_search_indexes`).** `ticket(status, updated_at)` for the Status-ordered cursor, `ticket(ticket_type_id)`, `ticket(assignee_id)`. There is no index for the Field values or the text search.
- **Similar tickets.** `GET /api/v1/tickets/similar?title=` returns at most 5 open tickets (Status Category is not `done`) that the caller can read. Words of 3 letters or more from the title (at most 8); a ticket matches when its title has at least 2 of them (or the only one, for a one-word title), best match first. The form waits 400 ms after typing, ignores answers that arrive late, and hides the box when the request fails. Links open in a new tab, so the form is not lost.
- **Branch filter in the UI.** The menus for Type, Priority, and Branch follow the canvas. Branch is a normal Field (4.12), so the menu reads the options of the Field with key `branch` from the Ticket Types, and is hidden if none has one. If the Ticket Type menu cannot load, the list still works.
- **Filters in the address.** The search and the menus write to the address (`?q=&type=&priority=&branch=&filter=`), so a filtered list can be shared and the back button works. The search waits 300 ms after typing.

## Glossary terms to add

- **Cursor** — the opaque value in `next_cursor` that a list call sends back as `cursor` to get the next page. It marks the position of the last row in the sort order.
- **Similar tickets** — open tickets that the User can read whose titles share words with the title being typed in the New ticket form.

## Notes for later issues

- `listTickets(db, principal, filter, { cursor, limit })` in `server/utils/tickets.ts` is the one list query. Issue 11 (MCP search) and issue 12 (API keys) should call it, not copy it. New filters go in `filterCondition`, after the `readableTickets` line.
- `GET /api/v1/tickets` now answers `next_cursor`. The UI types are in `app/types/tickets.ts`. Any client that read "at most 200" must page.
- There is no MCP tool for search or similar tickets yet. When one is added, return ticket text with the untrusted marker of issue 11.
- If a later issue adds a Field filter for dates or numbers (ranges), add it next to `fieldCondition`; the current one only does equality.
- Issue 08 (type change) keeps the number, so search by reference keeps working with no change.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
