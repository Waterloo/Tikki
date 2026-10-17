# 11 · Claude: follow-up for Requesters and tools for Agents

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Requesters follow their tickets from Claude, and Agents work from Claude, with the same permissions as in the web app.

- Tools for everyone: `list_my_tickets`, `get_ticket` (Status, Field values, Public Comments; Internal Comments only for Agents), `add_comment`.
- Tools for Agents: `search_tickets`, `assign_ticket`, `change_status`, `change_priority`. Every call goes through the policy function.
- No delete tool and no bulk tool. One ticket for each call.
- Ticket text in tool results is marked as untrusted user content.
- Write tools have confirmation annotations. Each change is recorded "via AI by <User>".

## Acceptance criteria

- [ ] MCP test: a Requester's `get_ticket` never contains Internal Comments.
- [ ] MCP test: a Requester calling an Agent tool gets the same refusal as REST.
- [ ] MCP test: the tool list contains no delete or bulk tool.
- [ ] MCP test: ticket text is wrapped in the untrusted-content marker.
- [ ] Manual check in claude.ai: "what is happening with my payment issue?" returns the real Status and last Public Comment.

## Blocked by

- [06 · Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md)
