# 36 · WebMCP tools in the Tikki page

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Research and reasons: [docs/research/webmcp.md](../research/webmcp.md). Owner decision, 2026-10-18: build a small slice now, no flag.

## What to build

ChatGPT calls WebMCP tools in the built-in browser of its desktop app. When a user has Tikki open there, the agent should work on "this ticket" with the user's session and no connector setup.

- When `document.modelContext?.registerTool` is a function, the SPA registers the tools below. Otherwise it does nothing: no error, no log, no polyfill.
- One composable, `app/composables/useWebMcpTools.ts`, owns every `registerTool` call. Each tool is registered with an `AbortSignal`. Sign-out aborts all tools. Leaving the ticket page aborts the current-ticket tools.
- Each `execute` calls the existing REST API with `$fetch` and the header `X-Tikki-Channel: ai`. No new route. No permission code in the browser.
- Results use the same fields and wording as the `/mcp` tool each one mirrors. Every user-written string is wrapped with `untrusted()` / `untrustedDeep()`, and the result has `UNTRUSTED_NOTICE` (5.12). Move `server/utils/untrusted.ts` to `shared/untrusted.ts`; `mcp.ts` imports it from there.
- A REST error becomes a tool result with the error code and message, as `run()` in `mcp.ts` does (5.11). `RATE_LIMITED` keeps `retry_after`.
- After a write, the ticket page shows the change without a reload.

### Tools

| Tool | Registered | Mirrors in `/mcp` | Annotations | REST |
|---|---|---|---|---|
| `get_current_ticket` | ticket page, after the ticket loads | `get_ticket` | `readOnlyHint`, `untrustedContentHint` | `GET /api/v1/tickets/{ref}`, `GET .../comments` (newest 20) |
| `add_comment_to_current_ticket` | ticket page | `add_comment` (`body`, `visibility`) | `consequentialHint` | `POST /api/v1/tickets/{ref}/comments` |
| `change_current_ticket_status` | ticket page, only when `allowed_actions` lets the user change Status | `change_status` (`status`) | `consequentialHint` | `PATCH /api/v1/tickets/{ref}` |
| `search_my_tickets` | every signed-in page | `list_my_tickets` + `search_tickets` (`query?`, `open_only?`) | `readOnlyHint`, `untrustedContentHint` | `GET /api/v1/tickets?requester=me&q=&open=` |
| `get_ticket_types` | every signed-in page | `list_ticket_types` + `get_ticket_type` | `readOnlyHint` | `GET /api/v1/ticket-types`, `GET /api/v1/ticket-types/{id}` |
| `create_ticket` | every signed-in page | `create_ticket` (with `confirm_new`) | `consequentialHint` | `GET /api/v1/tickets/similar`, then `POST /api/v1/tickets` |

- Current-ticket tools take no ticket argument. They act on the ticket that the page shows.
- `get_ticket_types` returns each type's Fields as JSON Schema. Move `fieldsToJsonSchema` from `server/utils/mcp-schema.ts` to `shared/` (it imports only a type).
- `create_ticket` checks similar open tickets first and creates nothing when it finds some, unless `confirm_new` is true (5.17). It returns the matches, wrapped.
- Every write description ends with "Ask the user to confirm before you call it.", as in `/mcp`. Do not rely on the agent reading `consequentialHint`.

### Server: the channel header

In `restPrincipal` / `sessionPrincipal` (`server/utils/rest.ts`):

- `X-Tikki-Channel: ai` on a session request gives `channel: 'ai'`. Any other value answers `400 INVALID_CHANNEL`. The header on an API-key request also answers `400`, so a wrong client fails visibly.
- A request with the header takes the `mcp:{userId}` slot (`USER_MCP_LIMIT`), and also `mcp-write:{userId}` (`USER_MCP_WRITE_LIMIT`) for a method other than `GET`. Reuse `takeToolSlot` logic from `mcp.ts`; do not copy it (move it to `rate-limit.ts`).
- The header changes the label only. The read rule and every check stay the same (5.1).

### UI: the AI label

`SourceChip.vue` shows channel `ai` as "Claude". ChatGPT uses both `/mcp` and these tools, and Tikki cannot tell the agents apart. Change the label to "AI". Same in the Activity line (`SOURCE` in `TicketConversation.vue`).

### Ticket Apps (issue 34)

The Ticket App `<iframe>` has no `allow="tools"`. If issue 34 is merged first, add a test here; if not, issue 34 adds it.

## Acceptance criteria

Test with a stub of `document.modelContext`, not with a real agent. In `e2e/webmcp.spec.ts`, `page.addInitScript` defines `modelContext` on `Document.prototype` before the SPA loads. The stub's `registerTool(tool, { signal })` stores the tool in `window.__tools` and deletes it when `signal` aborts. Tests call `window.__tools.get(name).execute(input)` through `page.evaluate` and check the result and the page.

- [ ] Playwright: without the stub, the page loads with no console error, and nothing touches `modelContext`.
- [ ] Playwright: with the stub, on a ticket page, the six tools are registered with the annotations in the table. On the ticket list, only the three page-independent tools are registered. After navigation away from the ticket, the current-ticket tools are gone.
- [ ] Playwright: `get_current_ticket` returns the open ticket. The title, description, Field values and comment bodies are inside `<untrusted_content>`, and a body that contains `</untrusted_content>` cannot close the marker.
- [ ] Playwright: `add_comment_to_current_ticket` adds a comment. It appears in Conversation without a reload, with the "AI" chip.
- [ ] Playwright: an Agent's `change_current_ticket_status` changes the Status. Activity shows "AI" and Revert works. A Requester has no such tool.
- [ ] Playwright: as a Requester, `get_current_ticket` on a ticket with an Internal Comment does not return it.
- [ ] Playwright: `create_ticket` with a title like an open ticket creates nothing and lists the match. With `confirm_new: true` it creates the ticket.
- [ ] Playwright: sign-out removes every tool.
- [ ] Worker test: a session request with `X-Tikki-Channel: ai` writes `channel = 'ai'` in the comment, the audit entry and the outbox Event. Without the header it is `web`.
- [ ] Worker test: `X-Tikki-Channel: robot` answers `400 INVALID_CHANNEL`. An API-key request with the header answers `400`.
- [ ] Worker test: the header puts writes under `USER_MCP_WRITE_LIMIT`. The next write answers `RATE_LIMITED` with `retry_after`.
- [ ] Unit test: the shared `untrusted()` is the only wrapper; `mcp.ts` and the composable import it from `shared/`.
- [ ] `e2e/frame-protection.spec.ts` passes unchanged.
- [ ] The layout spec passes.
- [ ] `docs/DECISIONS.md` gets rows: WebMCP tools call REST only; `X-Tikki-Channel: ai` is a label under the MCP rate limits; the `ai` chip says "AI".
- [ ] `docs/architecture.md`, Principal section: the header is the third way to get channel `ai`.

## Blocked by

None. Coordinate with issue 34 on the `allow="tools"` test.

## Not verified

- No test with a real ChatGPT desktop app. The stub follows the 2026-10-16 spec and OpenAI's example. A manual check in the ChatGPT desktop built-in browser is a follow-up for the owner.

## Out of scope

- Priority, assignment, Team, Ticket Type change, Restricted, delete, attachments. Add later only with evidence that users want them from the page.
- The declarative form API (ChatGPT does not support it).
- Tools on admin pages. Tools from Ticket Apps.
