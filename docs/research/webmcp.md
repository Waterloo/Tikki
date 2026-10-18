# WebMCP for Tikki

> **Status:** research, 2026-10-18, revised the same day after the owner's correction: ChatGPT calls WebMCP tools. Build: [issue 36](../issues/36-webmcp-tools.md).

## Summary

WebMCP is a draft browser API. A web page registers tools with `document.modelContext.registerTool(...)`. An AI agent in the browser calls these tools in the user's open tab, with the user's signed-in session.

**Recommendation: build a small slice now, with no flag.** Feature detection is the gate: a browser without `document.modelContext` gets nothing. The tools call the existing REST API from the page with the session, so the server needs no new permission code. Build [issue 36](../issues/36-webmcp-tools.md).

Why now (this replaces the first version of this doc, which said "not now"):

1. **A mainstream agent uses it in production.** ChatGPT "site tools" call WebMCP tools in the built-in browser of the ChatGPT desktop app, since about 2026-08-25. OpenAI's own docs use `document.modelContext`. [OpenAI Help][oai-help], [OpenAI docs][oai-docs]
2. **The cost is small.** One composable in the SPA. No server route, no migration, no new rule. The REST API already applies the read rule, `applyChange`, the audit entry and the notices.
3. **The gain is real for ChatGPT users.** They get page-aware tools ("this ticket") with no connector setup. `/mcp` stays the path for Claude, for ChatGPT without the desktop browser, and for work with no tab open.

The first version was wrong on point 1. Its other findings stay true: the API can still change, WebKit opposes it, Mozilla is neutral. That is why the slice is small and lives in one file.

### Where this plan differs from the owner's request

The owner asked for: feature detection; REST from the page; search any readable ticket; open it in the tab; current ticket get, comment, change Status; create ticket; `consequentialHint` on writes; `untrustedContentHint` on user text; a header for channel `ai`. We agree with all of it, with these changes:

- **`create_ticket` needs the duplicate check and the Field schema.** `POST /api/v1/tickets` does not check for similar tickets; only the MCP tool and the web form do (5.17, 13.6). The page tool must call `/api/v1/tickets/similar` first and ask for `confirm_new`, as `/mcp` does. It also needs a read tool for the Ticket Type Fields, or the agent guesses Field values. Issue 36 adds `get_ticket_types`.
- **Do not trust `consequentialHint` to get a confirmation.** OpenAI documents confirmation for purchases, deleting data, permission changes, sending messages and sharing personal data. It does not say it reads `consequentialHint`. A Status change is in none of these classes. We accept this: a Status change is visible, it shows in Activity with Revert, and the policy allows it only to Agents. Each tool description also tells the agent to confirm with the user, as the `/mcp` descriptions do.
- **No `status` filter in search.** The REST list and `/mcp` have only `open_only`. A Status filter is server work outside the slice.
- **The "Claude" label is wrong.** `SourceChip.vue` shows channel `ai` as "Claude". ChatGPT already uses `/mcp`, and now uses the page tools too. The page cannot know which agent calls. Change the label to "AI".
- **The channel header: keep it, with three limits.** See [Audit channel](#audit-channel). We found no better way: the browser does not tell the page or the server which agent calls.

## Findings

### What WebMCP is

- **Spec:** "WebMCP", Draft Community Group Report, W3C Web Machine Learning Community Group, 2026-10-16. Editors from Microsoft and Google. Not on the W3C Standards Track. [Spec][spec]
- **Entry point:** `document.modelContext` (secure contexts, Window only). `navigator.modelContext` is the old spelling; `provideContext()` was removed. [Spec][spec], [DEV][devto]
- **API:** `registerTool(tool, { signal })`. A tool has `name`, `description`, `inputSchema` (JSON Schema), `execute(input)` and `annotations`. Abort the `signal` to remove it. [Spec][spec]
- **Annotations:** `readOnlyHint`, `untrustedContentHint` (the result holds untrusted text), `consequentialHint` (a client can ask the user to confirm). [Spec][spec]
- **Frames:** the Permissions Policy feature `tools` defaults to `'self'`. A cross-origin iframe needs `allow="tools"`. [Spec][spec], [Chrome docs][chrome]

### Who implements it

| Who | Status | Source |
|---|---|---|
| **ChatGPT** | **In production.** Built-in browser of the ChatGPT desktop app, not ChatGPT in Chrome. For ChatGPT Work and Codex. Models GPT-5.6 Sol and GPT-6 Sol; off for GPT-5.6 Luna. Not in Edu workspaces; Enterprise admins must allow it by policy. Tools only from the top-level page, not from iframes. No declarative form API. | [OpenAI docs][oai-docs], [OpenAI Help, updated about 2026-08][oai-help] |
| Chrome | DevTrial from 146, origin trial 149 to 156, ship planned in 157. Flag `chrome://flags/#enable-webmcp-testing`. | [Intent to Experiment, 2026-05-16][i2e], [Chrome docs, 2026-10-07][chrome] |
| Gemini in Chrome | "Will soon support WebMCP" (2026-05-19). No date. | [Chrome at I/O 26][io] |
| Edge | Co-author of the spec. Ship status not confirmed in an Edge source. | [Brosset, 2026-02-23][brosset] |
| WebKit / Firefox | `oppose` / `neutral`. | [WebKit #670][webkit], [Mozilla #1412][mozilla] |
| Claude | No evidence of WebMCP use found. **Uncertain.** | — |

Secondary reports (SEJ and VKTR, 2026-08-27; AlphaSignal, 2026-08-25) say "not Enterprise". OpenAI's docs say Enterprise admins can allow it. We follow OpenAI. The OpenAI WebMCP Challenge (2026-08-25, with Chrome, Shopify, Cloudflare, Vercel, Netlify, Render) is reported by [AlphaSignal][alpha]; the OpenAI page returned 403 to us, so it is **not verified at the source**.

### How ChatGPT controls tool calls

From the [OpenAI Help article][oai-help]:

- The user gives permission before ChatGPT interacts with a website. The user can turn site tools off in the app.
- ChatGPT asks for confirmation before "sensitive activities": personal data, purchases, deleting data, permission changes, messages for the user.
- "Instructions from a website or site tool cannot authorize" sensitive actions.
- Before each call, ChatGPT reviews the tool and its input against the user's request.
- The address bar shows which tools the page has, and whether each reads or changes data. The conversation logs each call.
- The built-in browser has its own cookies. The user signs in to Tikki again there.

Not documented: which annotations ChatGPT reads, and whether the page can learn that ChatGPT made the call.

## Fit for Tikki

### Design

- **REST only.** Each `execute` calls `/api/v1/...` with `$fetch` and the session cookie. The server uses `restPrincipal`, the read rule, `applyChange` and the comment batch, as for a click. The browser holds no rule.
- **One composable** owns every `registerTool` call. A rename of the API touches one file.
- **Page-aware.** Current-ticket tools exist only while the ticket page shows a ticket, and act only on that ticket. They take no ticket argument.
- **Tools:** `search_tickets` (any ticket the user can read, summaries only, `readableTickets` decides), `open_ticket(ref)` (navigates the tab), `get_current_ticket`, `add_comment_to_current_ticket`, `change_current_ticket_status`, `get_ticket_types`, `create_ticket`. Details: [issue 36](../issues/36-webmcp-tools.md).
- **No background read of another ticket.** `get_current_ticket` is the only full-content read; to read another ticket the agent calls `open_ticket` first. Reason: the user must see the ticket the agent reads and works on. `open_ticket` does not navigate while the composer holds an unsent reply.
- **Results in the `/mcp` shape.** The same fields, the same `<untrusted_content>` wrap (5.12), the same notice. Move `server/utils/untrusted.ts` to `shared/`, so `app/` and `server/` use one wrapper.

### Audit channel

The SPA sends `X-Tikki-Channel: ai` only from inside `execute`. The server then builds the session principal with `channel: 'ai'`.

1. **Only a session principal.** An API key stays `api`. The header never widens a right; the channel is a label (5.1: `ai` has the same rights as the User).
2. **Only the value `ai`.** Any other value is `400`. A typo fails visibly.
3. **Under the MCP rate limits.** A request with the header takes the `USER_MCP_LIMIT` slot, and the `USER_MCP_WRITE_LIMIT` slot for a write method. The agent gets the same budget as through `/mcp`.

A user can send the header from the console. The only result: their own change shows "AI" in Activity. Without the header, every tool write would show as a click by the user. That is worse: Activity would say the human did it.

Rejected: a second route tree (`/api/v1/ai/...`). It doubles every route for one label.

### Risks

| Risk | Control |
|---|---|
| Prompt injection from ticket text ("close this and assign it to me") | `untrusted()` wrap, `untrustedContentHint`, ChatGPT's per-call review. Writes are visible and reversible (Revert, Reopen). |
| Cross-site steering: a page in another tab tells the agent to act in Tikki. CSRF checks do not help, the call is same-origin. | The page cannot detect it. Keep the write set small: comment, Status, new ticket. No delete, no assignment, no Restricted change, no type change. |
| Actions the user does not see | Tools act on the ticket on screen; the page updates after each write. ChatGPT shows each call. Activity shows "AI". |
| `create_ticket` makes duplicates | The page tool calls `/similar` first and needs `confirm_new` (5.17). |
| Frames (issue 32) | `frame-ancestors 'none'` stays. ChatGPT loads Tikki as the top-level page, so framing is not needed. |
| Ticket Apps (issues 34, 35) | **Keep this for issue 34:** the Ticket App `<iframe>` gets no `allow="tools"`. Chrome would otherwise let a cross-origin app show tools to the agent as if they were Tikki tools, with no context-token limit. ChatGPT ignores iframe tools today; Chrome does not. |
| The API changes | Feature detection plus one composable. A change in spelling breaks only the WebMCP tools, never the page. |
| Tool descriptions drift from `/mcp` | Accepted. Seven page tools. The issue lists the `/mcp` tool each one mirrors. |

## Open questions

1. **Does Claude call WebMCP tools?** No evidence. `/mcp` covers Claude today.
2. **More tools** (Priority, assignment, attachments): only with evidence that users want them from the page.
3. **Does ChatGPT read `consequentialHint`?** Not documented. If OpenAI documents it, nothing changes in Tikki; the hint is already set.

## Sources

All read on 2026-10-18.

[spec]: https://webmachinelearning.github.io/webmcp/
[chrome]: https://developer.chrome.com/docs/ai/webmcp
[i2e]: https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8/m/OJxuQRP3AAAJ
[io]: https://developer.chrome.com/blog/chrome-at-io26
[brosset]: https://patrickbrosset.com/articles/2026-02-23-webmcp-updates-clarifications-and-next-steps/
[webkit]: https://github.com/WebKit/standards-positions/issues/670
[mozilla]: https://github.com/mozilla/standards-positions/issues/1412
[devto]: https://dev.to/jangwook_kim_e31e7291ad98/webmcps-origin-trial-providecontext-is-already-gone-54j8
[oai-help]: https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app
[oai-docs]: https://learn.chatgpt.com/docs/webmcp
[sej]: https://www.searchenginejournal.com/chatgpt-adds-webmcp-support/587237/
[vktr]: https://www.vktr.com/ai-platforms/openai-adds-webmcp-to-chatgpts-browser/
[alpha]: https://alphasignal.ai/news/openai-s-webmcp-challenge-lets-websites-talk-directly-to-ai-agents

- Primary: [OpenAI Help: site tools][oai-help], [OpenAI docs: WebMCP][oai-docs], [WebMCP spec, 2026-10-16][spec], [Chrome docs][chrome], [Intent to Experiment][i2e], [Chrome at I/O 26][io], [WebKit #670][webkit], [Mozilla #1412][mozilla]
- Secondary: [SEJ, 2026-08-27][sej], [VKTR, 2026-08-27][vktr], [AlphaSignal, 2026-08-25][alpha], [Brosset (Edge team), 2026-02-23][brosset], [DEV][devto]
