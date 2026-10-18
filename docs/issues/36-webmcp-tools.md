# 36 · WebMCP tools in the Tikki page

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Research and reasons: [docs/research/webmcp.md](../research/webmcp.md). Owner decision, 2026-10-18: build a small slice now, no flag.

## What to build

ChatGPT calls WebMCP tools in the built-in browser of its desktop app. When a user has Tikki open there, the agent should find any ticket the user can read, open it in the user's tab, read it, and work on it, with the user's session and no connector setup.

- When `document.modelContext?.registerTool` is a function, the SPA registers the tools below. Otherwise it does nothing: no error, no log, no polyfill.
- One composable, `app/composables/useWebMcpTools.ts`, owns every `registerTool` call. Each tool is registered with an `AbortSignal`. Sign-out aborts all tools. Leaving the ticket page aborts the current-ticket tools.
- Each `execute` calls the existing REST API with `$fetch` and the header `X-Tikki-Channel: ai`. No new route. No permission code in the browser.
- Results use the same fields and wording as the `/mcp` tool each one mirrors. Every user-written string is wrapped with `untrusted()` / `untrustedDeep()`, and the result has `UNTRUSTED_NOTICE` (5.12). Move `server/utils/untrusted.ts` to `shared/untrusted.ts`; `mcp.ts` imports it from there.
- A REST error becomes a tool result with the error code and message, as `run()` in `mcp.ts` does (5.11). `RATE_LIMITED` keeps `retry_after`.
- After a write, the ticket page shows the change without a reload.

### Tools

| Tool | Registered | Mirrors in `/mcp` | Annotations | REST |
|---|---|---|---|---|
| `get_current_ticket` | ticket page, after the ticket loads | `get_ticket` | `readOnlyHint`, `untrustedContentHint` | `GET /api/v1/tickets/{ref}`, `GET .../comments` (newest 20), `GET .../attachments` (names only) |
| `add_comment_to_current_ticket` | ticket page | `add_comment` (`body`, `visibility`) | `consequentialHint` | `POST /api/v1/tickets/{ref}/comments` |
| `change_current_ticket_status` | ticket page, only when `allowed_actions` lets the user change Status | `change_status` (`status`) | `consequentialHint` | `PATCH /api/v1/tickets/{ref}` |
| `search_tickets` | every signed-in page | `search_tickets`, and `list_my_tickets` through `mine` | `readOnlyHint`, `untrustedContentHint` | `GET /api/v1/tickets` |
| `open_ticket` | every signed-in page | none (page only) | `readOnlyHint` | `GET /api/v1/tickets/{ref}`, then router navigation |
| `get_ticket_types` | every signed-in page | `list_ticket_types` + `get_ticket_type` | `readOnlyHint` | `GET /api/v1/ticket-types`, `GET /api/v1/ticket-types/{id}` |
| `create_ticket` | every signed-in page | `create_ticket` (with `confirm_new`) | `consequentialHint` | `GET /api/v1/tickets/similar`, then `POST /api/v1/tickets` |

- Current-ticket tools take no ticket argument. They act on the ticket that the page shows.
- **`search_tickets`** inputs map 1:1 to the real query parameters of `server/api/v1/tickets/index.get.ts`: `query` → `q` (words or a Ticket Reference), `mine: true` → `requester=me`, `assignee` (`me`, `none` or a User id) → `assignee`, `ticket_type_id` → `type`, `team_id` → `team`, `priority` → `priority`, `fields` (`{key: value}`) → repeated `field=key:value`, `open_only: true` → `open=true`, `limit`, `cursor`. The session principal goes through `readableTickets`, so the server alone decides what a Requester, an Agent or a Participant of a Restricted ticket finds. The result is summaries only (ref, title, Status, Priority, type, updated), with the title wrapped by `untrusted()`, and `next_cursor`.
- **No `status` filter.** The REST list and `/mcp` `search_tickets` have none: only `open_only`. Adding one is server work outside this slice. The agent filters the page of summaries by Status itself.
- **`open_ticket(ref)`** first calls `GET /api/v1/tickets/{ref}`. A `404` returns `NOT_FOUND` as a tool result, and the tab stays where it is. Otherwise it calls `router.push` to `/tickets/{ref}` and resolves only after the ticket has loaded and the current-ticket tools are registered for it (wait for the registration, not a timer; fail with `TIMEOUT` after 10 s). It returns `ref`, `title` (wrapped) and `status`. The `ref` is the current reference: an old prefix or a bare number resolves as on the page (4.9a).
- **`open_ticket` keeps a draft.** If the comment composer of the open ticket has unsent text, it returns `DRAFT_OPEN` ("The user has an unsent reply on {ref}. Ask the user first.") and does not navigate. The ticket page has no leave guard today, so a navigation would lose the text.
- **No background `get_ticket(ref)`.** `get_current_ticket` is the only full-content read (description, Fields, newest comments, attachment names). To read another ticket, the agent calls `open_ticket` first. Reason: the user must see the ticket the agent reads and works on. A background read would let the agent read and quote tickets that the user never sees on the screen, and write on one ticket while the user looks at another. Search summaries are the exception, as the ticket list page shows the same data.
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

The stub also throws on a duplicate name, as the spec says, so a missing abort fails the tests.

- [x] Playwright: without the stub, the page loads with no console error, and nothing touches `modelContext`. `e2e/webmcp.spec.ts` "without WebMCP…": `'modelContext' in document` stays false, no console or page error.
- [x] Playwright: with the stub, on a ticket page, the seven tools are registered with the annotations in the table. On the ticket list, only the four page-independent tools are registered. After navigation away from the ticket, the current-ticket tools are gone. `e2e/webmcp.spec.ts` "a ticket page has the seven tools…" (client-side navigation through the breadcrumb).
- [x] Playwright: `get_current_ticket` returns the open ticket. The title, description, Field values and comment bodies are inside `<untrusted_content>`, and a body that contains `</untrusted_content>` cannot close the marker. `e2e/webmcp.spec.ts` "get_current_ticket wraps user text…" (also an upper-case closing tag).
- [x] Playwright: `add_comment_to_current_ticket` adds a comment. It appears in Conversation without a reload, with the "AI" chip. `e2e/webmcp.spec.ts` "add_comment_to_current_ticket shows the comment…" (a window flag proves no reload).
- [x] Playwright: an Agent's `change_current_ticket_status` changes the Status. Activity shows "AI" and Revert works. A Requester has no such tool. `e2e/webmcp.spec.ts` "an Agent changes the Status…".
- [x] Playwright: as a Requester, `get_current_ticket` on a ticket with an Internal Comment does not return it. `e2e/webmcp.spec.ts` "a Requester does not get an Internal Comment…".
- [x] Playwright: an Agent's `search_tickets` finds another Requester's ticket, by words and by its Ticket Reference. `e2e/webmcp.spec.ts` "search_tickets: an Agent finds…".
- [x] Playwright: a Requester's `search_tickets` does not find another Requester's ticket of a type that is not visible to all, and no summary contains Internal-only data. Same test: a General request (visibility Requester), by words and by reference; the summary keys are exactly the `/mcp` summary keys, and the Internal Comment text is in no result.
- [x] Playwright: a Restricted ticket is found by its Participants and by an Admin, and not by another Agent. `e2e/webmcp.spec.ts` "a Restricted ticket is found…" (the Requester and an added Participant).
- [x] Playwright: `search_tickets` with `mine: true` returns only the user's own tickets; `open_only: true` leaves out resolved and closed ones. `e2e/webmcp.spec.ts` "search_tickets with mine and open_only".
- [x] Playwright: `open_ticket` on another readable ticket navigates the tab. The promise resolves after the page shows it, and `get_current_ticket` then returns that ticket. `e2e/webmcp.spec.ts` "open_ticket navigates the tab…" (with a bare number; the URL and the heading are checked with no wait).
- [x] Playwright: `open_ticket` with an unknown ref, and with a ref the user cannot read, returns `NOT_FOUND` in both cases, and the URL does not change. `e2e/webmcp.spec.ts` "open_ticket answers NOT_FOUND…".
- [x] Playwright: `open_ticket` while the composer has unsent text returns `DRAFT_OPEN`, the URL does not change, and the text is still there. `e2e/webmcp.spec.ts` "open_ticket does not leave an unsent reply".
- [x] Playwright: `create_ticket` with a title like an open ticket creates nothing and lists the match. With `confirm_new: true` it creates the ticket. `e2e/webmcp.spec.ts` "create_ticket lists a similar open ticket…" (the new ticket has channel `ai`).
- [x] Playwright: sign-out removes every tool. `e2e/webmcp.spec.ts` "sign-out removes every tool".
- [x] Worker test: a session request with `X-Tikki-Channel: ai` writes `channel = 'ai'` in the comment, the audit entry and the outbox Event. Without the header it is `web`. `test/worker/webmcp-channel.test.ts`.
- [x] Worker test: `X-Tikki-Channel: robot` answers `400 INVALID_CHANNEL`. An API-key request with the header answers `400`. Same file.
- [x] Worker test: the header puts writes under `USER_MCP_WRITE_LIMIT`. The next write answers `RATE_LIMITED` with `retry_after`. Same file: the 11th write answers 429 with `Retry-After`. The unit test checks that the tool result keeps `retry_after`.
- [x] Unit test: `search_tickets` builds the expected query string from every input, and rejects an unknown input key. `test/unit/webmcp.test.ts`.
- [x] Unit test: the shared `untrusted()` is the only wrapper; `mcp.ts` and the composable import it from `shared/`. `test/unit/webmcp.test.ts` scans `app/`, `server/` and `shared/`. The tools live in `app/utils/webmcp.ts` (the composable registers them), so the test checks that file and `mcp.ts`.
- [x] `e2e/frame-protection.spec.ts` passes unchanged.
- [x] The layout spec passes.
- [ ] `docs/DECISIONS.md` gets rows: WebMCP tools call REST only; `X-Tikki-Channel: ai` is a label under the MCP rate limits; the `ai` chip says "AI". Not edited here: `docs/agents/parallel-work.md` keeps DECISIONS.md for the lead. The rows are under "Decisions made here", ready to copy.
- [x] `docs/architecture.md`, Principal section: the header is the third way to get channel `ai`. Also "Text for the AI" points to `shared/untrusted.ts` and names the composable.
- [x] `README.md`, "Use it from an AI assistant": one row for the ChatGPT desktop browser (WebMCP): open Tikki in the app's browser, and ChatGPT can search, open and update tickets in your tab with no connector. The `ai` source label change ("AI", not "Claude") is reflected wherever the README names the channel. The README named the channel only as "AI" already (Audit row); a new paragraph says changes show as "AI" in the Activity.
- [x] Ticket Apps: the `<iframe>` has no `allow` attribute; `e2e/ticket-apps.spec.ts` (issue 34) tests it already.

## Blocked by

None. Coordinate with issue 34 on the `allow="tools"` test.

## Not verified

- No test with a real ChatGPT desktop app. The stub follows the 2026-10-16 spec and OpenAI's example. A manual check in the ChatGPT desktop built-in browser is a follow-up for the owner.
- The result shape of `execute` is the MCP `CallToolResult` (`content`, `structuredContent`, `isError`). The spec lets `execute` return any value; we did not confirm what ChatGPT shows from it.
- The rate limits are tested in the Worker tests only: the e2e server runs with `RATE_LIMITS:off`.

## Out of scope

- Priority, assignment, Team, Ticket Type change, Restricted, delete, attachments. Add later only with evidence that users want them from the page.
- The declarative form API (ChatGPT does not support it).
- Tools on admin pages. Tools from Ticket Apps.

## Decisions made here

Rows for `docs/DECISIONS.md` (section 5):

| No. | Decision | Status |
|---|---|---|
| 5.18 | The WebMCP tools in the page call only the REST API, with `$fetch` and the session. The browser holds no permission rule; `readableTickets` and the policy decide, as for a click. Results have the fields and the wording of the `/mcp` tool each one mirrors, with the same `untrusted()` wrap (5.12). (issue 36) | Decided |
| 5.19 | `X-Tikki-Channel: ai` on a session request gives `channel: 'ai'`. It is a label only: the rights stay the User's (5.1). The request counts in `USER_MCP_LIMIT`, and a write (any method but `GET`/`HEAD`) also in `USER_MCP_WRITE_LIMIT`, in place of the web limit. Any other value, and the header on an API-key or context-token request, answers `400 INVALID_CHANNEL`. (issue 36) | Decided |
| 5.20 | The source chip and the Activity line show channel `ai` as "AI", not "Claude": ChatGPT uses `/mcp` and the page tools too, and Tikki cannot tell the agents apart. The ticket header says "from an AI assistant". (issue 36) | Decided |

Other decisions:

- **Files.** `app/composables/useWebMcpTools.ts` is the only caller of `registerTool`. The tool definitions and their `execute` are in `app/utils/webmcp.ts`, with the REST call, the navigation and the page state injected (`ToolDeps`). So the unit tests run them with a fake API and no Nuxt.
- **Page-independent tools** are registered in the default layout while a User is signed in. Pages with the `auth` layout (sign-in, consent, Upload Link) have no tools.
- **Current-ticket tools** are registered while the ticket page shows a loaded ticket. A reload of the ticket (state `loading`), another ticket, a change of `change_status` in `allowed_actions`, leaving the page and sign-out abort them. A Status change or a comment does not register them again.
- **The composer text** moved from `TicketConversation.vue` to the ticket page (`v-model:draft`), so `open_ticket` can see it. The behaviour of the composer is the same.
- **`open_ticket` on the ticket that is open** returns at once and does not check the draft: nothing navigates. The Edit form is not checked: the result text names only an unsent reply.
- **Input checks in the page.** A WebMCP client need not validate against `inputSchema`, so each tool checks its input against its own schema (unknown key, type, enum, range) and answers `INVALID_INPUT`. The server checks the values again.
- **Errors.** A REST error becomes `{ isError, content: "CODE: message", structuredContent: { error: { code, message } } }`, as `run()` in `mcp.ts`. `VALIDATION_FAILED` gives the `problems` list with the `/mcp` text. `RATE_LIMITED` keeps `retry_after` from `Retry-After`. A network error is thrown on, so the agent sees a failed call. `open_ticket` adds `DRAFT_OPEN` and `TIMEOUT` (10 s).
- **`get_current_ticket`** has the `get_ticket` fields of `/mcp`, plus `attachments`: the file names, wrapped (users choose them).
- **`get_ticket_types`** uses the REST list, so a Requester sees only the types they may use. `/mcp` `list_ticket_types` lists all types; that difference is not changed here.
- **`create_ticket`**: the title in the "Created" text is not wrapped, as in `/mcp`: it is the agent's own input.
- **Moves.** `server/utils/untrusted.ts` → `shared/untrusted.ts`. `server/utils/mcp-schema.ts` → `shared/fields-schema.ts`, with a structural `SchemaField` type in place of the server `FieldView`. `takeToolSlot` → `server/utils/rate-limit.ts`. The MCP output is the same; the MCP tests pass unchanged.

## Notes for later issues

- A new page tool goes into `app/utils/webmcp.ts`, and its write description ends with "Ask the user to confirm before you call it."
- The `/mcp` descriptions of `attach_text`, `request_upload_link`, `change_status`, `change_priority`, `assign_ticket`, `move_ticket_team` and `change_ticket_type` end with a copy of the `create_ticket` text about similar tickets. It does not apply to them. Not changed here, so the MCP output stays the same.
- If the ticket page gets a leave guard, `open_ticket` can use it in place of `DRAFT_OPEN`.

## Glossary terms to add

- **WebMCP tools**: tools that the Tikki page gives to an AI agent in the same browser tab (`document.modelContext`). They act as the signed-in User, through the REST API.
