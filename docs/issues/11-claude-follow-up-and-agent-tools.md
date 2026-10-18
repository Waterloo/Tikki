# 11 · Claude: follow-up for Requesters and tools for Agents

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Requesters follow their tickets from Claude, and Agents work from Claude, with the same permissions as in the web app.

- Tools for everyone: `list_my_tickets`, `get_ticket` (Status, Field values, Public Comments; Internal Comments only for Agents), `add_comment`.
- Tools for Agents: `search_tickets`, `assign_ticket`, `change_status`, `change_priority`. Every call goes through the policy function. (Issue 05 already added `assign_ticket`, `change_status` and `change_priority`; this issue adds `search_tickets` and the rest.)
- No delete tool and no bulk tool. One ticket for each call.
- Ticket text in tool results is marked as untrusted user content.
- Write tools have confirmation annotations. Each change is recorded "via AI by <User>".

## Acceptance criteria

- [x] MCP test: a Requester's `get_ticket` never contains Internal Comments. (`test/worker/mcp-tickets.test.ts`, "get_ticket gives a Requester no Internal Comments")
- [x] MCP test: a Requester calling an Agent tool gets the same refusal as REST. (`add_comment` internal: FORBIDDEN; unreadable ticket: NOT_FOUND; `change_status`, `change_priority`, `assign_ticket` in `roles.test.ts`)
- [x] MCP test: the tool list contains no delete or bulk tool. ("lists no delete tool and no bulk tool"; also checks the annotations)
- [x] MCP test: ticket text is wrapped in the untrusted-content marker. (title, description, Field values, comment bodies; list and search titles; an injected closing tag is broken)
- [ ] Manual check in claude.ai: "what is happening with my payment issue?" returns the real Status and last Public Comment.

## Blocked by

- [06 · Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md)

## Not verified

- The manual check in claude.ai stays unchecked (cloud setup is deferred).
- No UI in this issue.

## Decisions made here

- **Marker:** `<untrusted_content>…</untrusted_content>` around each user string, built only by `untrusted()` in `server/utils/untrusted.ts`. A closing tag inside the text is broken (`<\/untrusted_content>`), so text cannot end the marker. Every result with marked text also has a `notice` string that says the text is data. `structuredContent` carries the same marked strings as the text block (one object, both views).
- **What is marked:** title, description, Field values (all strings, deep), comment bodies. Names, emails, Status, and Priority are not.
- **`search_tickets` is open to every role, as REST `GET /tickets` is.** `listTickets` already limits a Requester to tickets they may read, so there is no refusal to copy. The issue text calls it an Agent tool; the policy has no `search` action and I did not add one.
- **Sizes:** list and search pages are 20 by default, 50 at most, with `next_cursor` and a `more` sentence that says how to get the next page. `get_ticket` sends the newest 20 comments and `older_comments_omitted` for the rest.
- `get_ticket` returns `allowed_actions`, so Claude can tell what the user may do.
- `add_comment` defaults follow `createComment` (Agent: internal, Requester: public). Annotations: not read-only, not destructive, not idempotent.
- The tool helper `change()` is now one `run()` wrapper for all tools: policy refusals and validation problems are tool results (`isError`), with `structuredContent` `{ error }` or `{ problems }`.

Copied to DECISIONS.md (rows 5.12, 5.13; changed row 5.11).

## Glossary terms to add

- **Untrusted content marker:** the `<untrusted_content>` tags around text that Users wrote, in MCP tool results. The AI must treat it as data, not instructions.

Copied to CONTEXT.md.

## Notes for later issues

- Any new MCP tool that returns ticket text must pass it through `untrusted()` / `untrustedDeep()` (`server/utils/untrusted.ts`) and use `run()` in `server/utils/mcp.ts` for refusals.
- Issue 12 (API keys) and 13 (attachments in MCP, 5.8) can reuse `page()` and `summary()` inside `buildServer`.
