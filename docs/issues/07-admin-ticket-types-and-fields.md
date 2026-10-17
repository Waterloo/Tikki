# 07 · Admin creates and edits Ticket Types and Fields

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Admins manage Ticket Types and their Fields without breaking old tickets. The screens follow the design canvas ("Ticket types", "New ticket type", "Ticket type fields").

- Types list with prefix, Field count, open tickets, Team, visibility, version, and archived types with Restore.
- One-page creation. Nothing is saved until Create, and Create makes Schema Version 1. The description is required. The icon is suggested from the name. The color is the first one no other type uses. The prefix is suggested from the name (first word if 5 letters or less, else its first 3 letters).
- Field editor: label, data type, required, help text, options. The Field Key is made from the label (`snake_case`) and is locked after creation. Quick-add for Branch, Due date, Screenshot.
- Blocked at input: a duplicate name (a link to Restore when an archived type has it), a duplicate prefix (archived prefixes stay reserved), a duplicate Field Key.
- Live previews: the requester card and "What Claude knows".
- Editing: each save makes a new Schema Version. Allowed: add Field, rename label, add or archive options, archive Field, restore Field, make required (new tickets only). Refused: change a data type, hard-delete a Field.
- Archive a Ticket Type: no new tickets of it, old ones keep it.

## Acceptance criteria

- [ ] REST test: create a type makes version 1. Editing Fields makes version 2. An old ticket stays on version 1 and still validates against it.
- [ ] REST test: changing a Field's data type or deleting it is refused with a clear error.
- [ ] REST test: duplicate name, prefix (including an archived type's prefix), and Field Key are refused.
- [ ] REST test: a ticket cannot be created with an archived type.
- [ ] MCP test: `get_ticket_type` returns the newest version after an edit.
- [ ] Playwright flow: an Admin creates "Access request" with two Fields, and a Requester sees it in the web form.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
