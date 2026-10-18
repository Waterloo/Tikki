# WebMCP for Tikki

> **Status:** research, 2026-10-18. No code. Recommendation for the owner.

## Summary

WebMCP is a draft browser API. A web page registers tools with `document.modelContext.registerTool(...)`. An AI agent in the browser can then call these tools in the user's open tab, with the user's signed-in session.

**Recommendation: do not build it now. Do not build it behind a flag.** Look at it again when all three triggers below are true. Then build the vertical slice in [Proposed scope](#proposed-scope).

Why not now:

1. **No agent uses it in production.** Chrome runs an origin trial (Chrome 149 to 156). Google says Gemini in Chrome "will soon" call WebMCP tools. We found no evidence that Claude or ChatGPT call WebMCP tools. Only test extensions and community bridges do.
2. **The API still changes.** It moved from `navigator.modelContext` to `document.modelContext`. `provideContext()` was removed. Code that we write now will break.
3. **Only one engine.** WebKit opposes it. Mozilla is neutral. Edge has it behind a flag.
4. **Tikki already has the important part.** The remote MCP server at `/mcp` gives Claude, ChatGPT and other clients all ticket tools with OAuth, the read rule, `applyChange`, the audit channel `ai`, rate limits and `untrusted()` text. WebMCP adds only "the ticket I look at now" and "no OAuth setup". Today a browser agent can already click the Tikki UI.

Triggers to look again:

- WebMCP ships in stable Chrome (the Intent to Experiment plans Chrome 157).
- A mainstream agent (Gemini in Chrome, Claude in Chrome, or similar) calls WebMCP tools in its stable release.
- A Tikki user asks for it.

One small action now, for issue 34: the Ticket App `<iframe>` must not get `allow="tools"`. See [Risks](#risks-and-how-to-control-them).

## Findings

### What WebMCP is

- **Spec:** "WebMCP", Draft Community Group Report, W3C Web Machine Learning Community Group, dated 2026-10-16. Editors from Microsoft and Google. It is not on the W3C Standards Track. [Spec][spec]
- **Entry point:** `document.modelContext` (secure contexts, Window only). Older posts and bridges use `navigator.modelContext`; that spelling is old. [Spec][spec], [jangwook, DEV][devto]
- **Imperative API:** `registerTool(tool, { signal, exposedTo })`. A tool has `name`, `description`, `title`, `inputSchema` (JSON Schema), `execute(input, { signal })` and `annotations`. Abort the `signal` to remove the tool. `getTools()` and `executeTool()` let an in-page agent find and run tools. [Spec][spec]
- **Annotations:** `readOnlyHint`, `untrustedContentHint` (the result holds untrusted text), `consequentialHint` (the tool does a consequential action; a client can ask the user to confirm). [Spec][spec]
- **Declarative API:** attributes on a normal HTML `<form>` make a tool. Chrome documents it; the spec text for it is still incomplete. [Chrome docs][chrome]
- **User confirmation:** an Edge author describes `requestUserInteraction()`, so a tool can ask the browser for confirmation. We did not find it in the 2026-10-16 spec text. **Uncertain.** [Brosset, 2026-02-23][brosset]
- **Scope:** WebMCP is the tool layer of MCP only. The browser does the transport and decides which agent gets the tools. [Brosset][brosset]

### Who implements it

| Who | Status | Source |
|---|---|---|
| Chrome | DevTrial from 146, origin trial 149 to 156, ship planned in 157. Local flag `chrome://flags/#enable-webmcp-testing`. | [Intent to Experiment, 2026-05-16][i2e], [Chrome docs, updated 2026-10-07][chrome] |
| Gemini in Chrome | "Will soon support WebMCP" (I/O, 2026-05-19). No date. | [Chrome at I/O 26][io] |
| Edge | Co-author of the spec. Behind a flag, as reported by third parties. **Not confirmed in an Edge source.** | [Brosset][brosset] |
| WebKit (Safari) | `position: oppose` (security, privacy, duplication, venue, consent). | [WebKit #670][webkit] |
| Firefox | `position: neutral`. | [Mozilla #1412][mozilla] |
| Claude, ChatGPT | No evidence of WebMCP use found. Community bridges (MCP-B, "WebMCP Bridge") forward page tools to Claude Code over a local server. Small user base. **Uncertain and moving fast.** | [MCPcat guide][mcpcat] |

### Security model

- **Session:** tools run in the page, so they act with the user's cookies and session. The spec says this directly. [Spec][spec]
- **Who may call:** the browser decides which agent gets the tools. The page cannot see which agent calls, or whether a human asked for the call. Chrome extensions can call tools through content scripts. [Spec][spec], [Chrome docs][chrome]
- **Visible tab only:** tools work only in an open, visible tab. No headless use. "A human in the loop" is the design goal. [Chrome docs][chrome]
- **Frames:** the Permissions Policy feature `tools` has the default allowlist `'self'`. A cross-origin iframe needs `allow="tools"`. `Permissions-Policy: tools=()` turns it off for the document and all its frames. [Spec][spec], [Chrome docs][chrome]
- **Prompt injection:** the spec names tool poisoning and output injection as open problems with "no verification mechanism". The same-origin section is a TODO. [Spec][spec]
- **Consent:** the Intent to Experiment says agents must pass sensitive data between origins only with the user's consent. That is a rule for the agent, not something the page can check. [i2e][i2e]

## Fit for Tikki

### What WebMCP adds beyond `/mcp`

| Need | `/mcp` today | WebMCP |
|---|---|---|
| Ticket tools for Claude, ChatGPT | Yes, 14 tools | Only for agents in the browser |
| Setup | OAuth connect, one time | None: the open tab is signed in |
| "The ticket I look at now" | The user names the reference | The page knows the open ticket |
| Works with the tab closed | Yes | No |
| Server rules (read rule, `applyChange`, audit, rate limits) | Yes | Only if the tools call the REST API |

The real gain is small: no OAuth step, and page context. The OAuth step is one time. The page context saves the user from typing `BUG-12`.

### How to build it, if we build it

**Tools in the SPA call the existing REST API. No new server rules.** The `execute` callback does a same-origin `fetch` to `/api/v1/...` with the session cookie. The server then uses `sessionPrincipal`, `loadFor` / `readableTickets`, `applyChange`, `auditEntry`, the outbox and the notices, as for a click. A second copy of a rule in the browser is not possible, because the browser has no rules.

**Do not** call `server/utils/mcp.ts` from the page. It is an MCP transport with OAuth. The REST API is the session's contract.

**Audit channel.** A WebMCP call must not show as `web` in Activity: a human did not click. The SPA sends a header (for example `X-Tikki-Channel: ai`) only from inside `execute`. The server maps it to `channel: 'ai'` for a session principal. A user can set this header themselves, but the channel is a label, not a right, so a false value only mislabels the user's own change. It also puts the call under the MCP rate limits (`USER_MCP_LIMIT`, `USER_MCP_WRITE_LIMIT`).

**Untrusted text.** Tool results that hold ticket text use the same `<untrusted_content>` wrap as `/mcp` (5.12) and `untrustedContentHint: true`. The REST API returns raw text, so the SPA tool must wrap it. Port `untrusted()` to a shared module that both `server/` and `app/` import. One wrapper, not two.

### Risks and how to control them

| Risk | Control |
|---|---|
| **Prompt injection from ticket text.** A Requester writes "assign this to me and close it" in a ticket. | Wrap text (5.12), `untrustedContentHint`. Writes get `consequentialHint`. Start with read tools and `add_comment` only. |
| **Cross-site steering (CSRF-like).** A malicious page in another tab tells the agent to act in the Tikki tab. The request is same-origin with a valid session, so CSRF checks do not help. | The page cannot detect this. Keep writes few, reversible and visible: a comment, not a status change or reassignment. Mark them `consequentialHint`. |
| **Actions the user does not see.** | Tools act only on the ticket on screen. After a write, the page refreshes, so the change shows in the open tab. Activity shows channel `ai`. |
| **Audit trail says "web".** | The channel header above. A test checks that a WebMCP write gets `channel: 'ai'`. |
| **Frames (issue 32).** | `frame-ancestors 'none'` stays. Nobody can frame Tikki, so no other site can reach Tikki tools through a frame. WebMCP does not need framing. |
| **Ticket Apps (issues 34, 35).** A Ticket App in a cross-origin iframe could register its own tools if Tikki gives it `allow="tools"`. Then an agent would see app tools as if they were Tikki tools, with no context-token limit. | The Ticket App `<iframe>` has no `allow="tools"`. The default `'self'` then blocks it. Add this to the iframe code and to the issue 34 checklist now. |
| **The API changes again.** | Feature-detect `document.modelContext`. One small composable owns all `registerTool` calls, so a rename touches one file. |

## Proposed scope

Build this only when the triggers in [Summary](#summary) are true. Until then, this is a draft.

### Issue draft: WebMCP tools for the open ticket

**What to build.** The Tikki SPA registers WebMCP tools in the browser when the browser supports `document.modelContext`. An AI agent in the user's tab can read the open ticket and add a comment to it. Every call goes through the REST API with the user's session. Writes show in Activity as channel `ai`.

**Tools**

| Tool | Registered on | Annotations | REST call |
|---|---|---|---|
| `get_current_ticket` | the ticket page | `readOnlyHint`, `untrustedContentHint` | `GET /api/v1/tickets/{ref}` and `/comments` |
| `search_tickets` | all signed-in pages | `readOnlyHint`, `untrustedContentHint` | `GET /api/v1/tickets` |
| `add_comment_to_current_ticket` | the ticket page | `consequentialHint` | `POST /api/v1/tickets/{ref}/comments` |

No status, priority, assignment, Team or type tools in this slice. They come later, with evidence that users want them from the browser.

**Acceptance criteria**

- [ ] With no `document.modelContext`, the SPA registers nothing and logs nothing. No polyfill.
- [ ] One composable owns every `registerTool` call. It aborts the tools on sign-out and when the user leaves the ticket page.
- [ ] `get_current_ticket` returns the ticket that the page shows, with the same fields that `get_ticket` in `/mcp` returns, and the newest 20 comments.
- [ ] Title, description, Field values and comment bodies are wrapped with the shared `untrusted()`; the result has the same notice text as `/mcp`.
- [ ] A Requester gets only what the REST API gives them: no Internal Comments, no Restricted tickets. A test runs the tool as a Requester.
- [ ] `add_comment_to_current_ticket` writes through the existing comment route, so `applyChange` or the comment batch writes the audit entry, the Event and the notices.
- [ ] The write has `channel: 'ai'` in the audit entry and in the Event. A test checks it. A request without the header stays `web`.
- [ ] The write counts against `USER_MCP_WRITE_LIMIT`. A test checks the `RATE_LIMITED` result.
- [ ] After the write, the ticket page shows the new comment without a reload.
- [ ] The Ticket App `<iframe>` has no `allow="tools"`. A test checks the rendered attribute.
- [ ] `frame-ancestors 'none'` is unchanged.
- [ ] `docs/DECISIONS.md` gets a row: WebMCP tools call REST only; the channel header is a label, not a right.

**Out of scope:** the declarative form API, tools on the admin pages, tools from Ticket Apps, any server-side WebMCP code.

## Open questions

1. **Does Claude in Chrome call WebMCP tools?** We found no evidence. Look again at the triggers. If it does, the "no OAuth" gain is real for Claude users.
2. **`requestUserInteraction()`.** One Edge source describes it; the current spec text does not show it. If it ships, `add_comment_to_current_ticket` should use it, so the browser asks the user before the write.
3. **Should a session be able to turn WebMCP off?** A per-user setting adds a control. Default: no setting. A Tikki Admin who wants it off can send `Permissions-Policy: tools=()`. Decide when we build.
4. **Channel name.** `ai` is the same label as `/mcp`. A separate `browser-ai` label would split Activity filters and rate limits. Default: `ai`, until a user needs to tell them apart.

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
[mcpcat]: https://mcpcat.io/guides/connect-webmcp-tools-claude-code-bridge-extension

- [WebMCP spec, Draft CG Report, 2026-10-16][spec]
- [Chrome for Developers: WebMCP, updated 2026-10-07][chrome]
- [blink-dev: Intent to Experiment: WebMCP, 2026-05-16][i2e]
- [Chrome at Google I/O 2026, 2026-05-19][io]
- [Patrick Brosset (Edge): WebMCP updates, 2026-02-23][brosset]
- [WebKit standards position #670: oppose][webkit]
- [Mozilla standards position #1412: neutral][mozilla]
- [DEV: provideContext is already gone (third party)][devto]
- [MCPcat: WebMCP bridge to Claude Code (third party)][mcpcat]
