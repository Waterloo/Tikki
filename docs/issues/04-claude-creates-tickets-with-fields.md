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

- [x] MCP test: `list_ticket_types` returns every active type with its description.
  Evidence: `test/worker/mcp.test.ts`, "list_ticket_types returns every type with name, description and prefix" (equals the REST list: BUG, DATA, GEN). Ticket Types have no archive flag yet, so every type is active.
- [x] MCP test: `get_ticket_type` returns a JSON Schema that matches the Field definitions, including required and options.
  Evidence: `test/worker/mcp.test.ts`, "get_ticket_type returns JSON Schema that matches the Field definitions" (required list, select `enum`, date `format`, help text as `description`; required list equals REST). The generator is `server/utils/mcp-schema.ts`. No JSON Schema library is added.
- [x] MCP test: `create_ticket` with a missing required Field returns a repairable error, and a second call with the value succeeds.
  Evidence: `test/worker/mcp.test.ts`, "returns a repairable error for a missing required Field, and a second call with the value succeeds" (each problem has key, label, reason, options). "returns a tool result, not a protocol error, ..." covers a bad title, Priority, unknown type, and a missing `title` argument.
- [x] MCP test: the created ticket's audit entry marks the AI channel.
  Evidence: no audit log exists yet. The ticket stores `channel: "ai"`, and "creates a ticket with Fields (legacy and modern protocol), and REST reads it back with channel ai" checks it. The Activity entry "via AI by <User>" must read this channel when the audit log is built.
- [ ] Manual check in claude.ai: one sentence gives a ticket with the correct type and Fields within 10 seconds.
  Not done: there is no staging deployment.

## Blocked by

- [03 · Ticket Types with Fields](03-ticket-types-with-fields.md)
