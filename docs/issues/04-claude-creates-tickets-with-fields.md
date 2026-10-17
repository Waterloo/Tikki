# 04 · Claude creates tickets with Fields

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Claude chooses the right Ticket Type, fills in the Fields it can infer, asks the User for the rest, and creates the ticket.

- MCP tools: `list_ticket_types` (name, description, prefix) and `get_ticket_type` (the current Fields as JSON Schema, generated from the Field definitions, with help text).
- `create_ticket` accepts a type, title, description, Priority, and Field values, and uses the same module code and Field validator as REST.
- A validation error comes back as a tool result that lists each problem with Field Key, label, reason, and allowed options, so Claude can ask exactly for the missing information.
- Write tools carry MCP annotations so Claude asks the User to confirm.
- The audit entry records "via AI by <User>".

## Acceptance criteria

- [ ] MCP test: `list_ticket_types` returns every active type with its description.
- [ ] MCP test: `get_ticket_type` returns a JSON Schema that matches the Field definitions, including required and options.
- [ ] MCP test: `create_ticket` with a missing required Field returns a repairable error, and a second call with the value succeeds.
- [ ] MCP test: the created ticket's audit entry marks the AI channel.
- [ ] Manual check in claude.ai: one sentence gives a ticket with the correct type and Fields within 10 seconds.

## Blocked by

- [03 · Ticket Types with Fields](03-ticket-types-with-fields.md)
