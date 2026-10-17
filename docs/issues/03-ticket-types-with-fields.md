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

- [ ] Table tests for the Field validator cover every data type, required, and unknown keys.
- [ ] REST test: create with valid values returns the Ticket Reference, and the values read back correctly.
- [ ] REST test: create with invalid values returns 422 with one entry for each Field problem (key, label, reason, options).
- [ ] REST test: two creates in different types get consecutive numbers with different prefixes.
- [ ] The seed creates the three example types and the Support Team on a fresh database only.
- [ ] Playwright flow: sign in, choose Bug, fill the Fields, submit, see the new reference.

## Blocked by

- [01 · Walking skeleton](01-walking-skeleton.md)
