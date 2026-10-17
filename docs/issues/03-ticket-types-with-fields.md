# 03 · Ticket Types with Fields and the web form

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

A Requester creates a ticket in the web app by choosing a Ticket Type and filling in that type's Fields.

- Ticket Types have a name, description, icon, color, prefix, owning Team, and visibility flag. Each type has a Schema Version 1 with its Fields.
- The pure **Field validator** checks submitted values against a Schema Version, for all data types (short text, long text, number, date, single select, multi select, checkbox, user, URL, file reference). Errors list Field Key, label, reason, and allowed options.
- Field values are stored on the ticket as one JSON object keyed by Field Key. The ticket is pinned to its Schema Version.
- Priority is a core attribute (`low`, `normal`, `high`, `urgent`; default `normal`).
- Ticket References: one global counter, with the type's prefix (`BUG-1047`, `PAY-1048`).
- A new install seeds three example types (Bug, Data request, General request) with 2–3 Fields each, and the "Support" Team.
- The web "New ticket" screen follows the design canvas: type cards, Fields for the chosen type with help text and required marks, Priority control.
- REST: list Ticket Types, get a Ticket Type with its current Fields, create a ticket with Field values.

## Acceptance criteria

- [x] Table tests for the Field validator cover every data type, required, and unknown keys.
  Evidence: `test/unit/fields.test.ts` (54 cases: valid and invalid values for all ten types, required for each type, a required checkbox, archived Fields and options, unknown keys, all problems at once).
- [x] REST test: create with valid values returns the Ticket Reference, and the values read back correctly.
  Evidence: `test/worker/tickets.test.ts`, "creates a ticket with Field values, returns the Ticket Reference, and reads the values back" (also checks Priority, Schema Version 1, and that values are trimmed and empty values left out).
- [x] REST test: create with invalid values returns 422 with one entry for each Field problem (key, label, reason, options).
  Evidence: `test/worker/tickets.test.ts`, "returns 422 with one entry for each Field problem" and "reports core attribute problems and Field problems together".
- [x] REST test: two creates in different types get consecutive numbers with different prefixes.
  Evidence: `test/worker/tickets.test.ts`, "gives consecutive numbers from one counter, with the prefix of each type" (`BUG-n`, then `DATA-n+1`).
- [x] The seed creates the three example types and the Support Team on a fresh database only.
  Evidence: the seed is in `migrations/0001_ticket_types_and_fields.sql`, which runs once for each database. `test/worker/ticket-types.test.ts`: "lists the three seeded types, owned by the Support Team" and "seeds once: applying the migrations again adds no type, Team, or Schema Version". On a database that already has issue 01 tickets, the migration pins them to Bug version 1 with Priority `normal` (checked with sqlite3 and foreign keys on).
- [x] Playwright flow: sign in, choose Bug, fill the Fields, submit, see the new reference.
  Evidence: `e2e/new-ticket.spec.ts`, "choose Bug, see Required errors, fill the Fields, and see the new reference" (signed in by `e2e/auth.setup.ts`; an empty submit shows the required errors on Title and "Page or feature"; then it fills the Fields, chooses High, and finds the new `BUG-n` in the list). The same flow was also done by hand in the browser against `wrangler dev` on 2026-10-18: sign in with a code, choose Bug, submit empty (Title and "Page or feature" show "Required."), fill the Fields, choose High, submit, and the toast and list show `BUG-1`. The API returned `fields: { page_or_feature: "Reports", frequency: "Every time" }`, `priority: "high"`, `schema_version: 1`.

## Notes for later issues

- Validation error entries are `{ key, label, reason, options? }`. Core attributes use their body name as `key` (`title`, `description`, `priority`, `ticket_type_id`, `fields`), so issue 07 must refuse these as Field Keys.
- Until issue 04, the MCP `create_ticket` tool created a General request (`GEN`), because Bug has a required Field that the tool could not fill. Issue 04 replaced this: the tool now takes a Ticket Type and its Field values.
- The validator checks the format of `user` and `file` values only. Issue 16 (Attachments) and issue 20 (People) must check that the referenced file or User exists.
- `ticket_type.team_id` is nullable in the database, because SQLite cannot add a NOT NULL column with a foreign key to a table that other tables reference. The code refuses a type without a Team with a clear error.
- Type icons are bundled into the client (`nuxt.config.ts`, `icon.clientBundle.icons`). An icon that is not in this list does not show. Issue 07 must choose from a fixed icon set and add it there.

## Blocked by

- [01 · Walking skeleton](01-walking-skeleton.md)
