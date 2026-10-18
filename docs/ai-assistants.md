# AI assistants (MCP)

Tikki is a remote [MCP](https://modelcontextprotocol.io/) server. Claude, ChatGPT, Cursor, VS Code and any other MCP client connect to it, and the user signs in with their work email. The assistant then acts as that user, with that user's permissions.

You need no API key. Each person connects their own assistant.

## Connect

The server URL is:

```text
https://tikki.example.com/mcp
```

| Assistant | How to connect |
|---|---|
| Claude (web and desktop) | Settings, Connectors, add a custom connector with the MCP URL. |
| Claude Code | `claude mcp add --transport http tikki https://tikki.example.com/mcp` |
| ChatGPT | Turn on developer mode, then add a connector with the MCP URL and OAuth. Availability depends on your plan. |
| Gemini CLI | In `settings.json`: `"mcpServers": { "tikki": { "httpUrl": "https://tikki.example.com/mcp" } }` |
| GitHub Copilot in VS Code | In `.vscode/mcp.json`: `"servers": { "tikki": { "type": "http", "url": "https://tikki.example.com/mcp" } }` |
| Cursor | In `~/.cursor/mcp.json`: `"mcpServers": { "tikki": { "url": "https://tikki.example.com/mcp" } }` |
| Other MCP clients | Add a remote server (Streamable HTTP) with the MCP URL. |

The client opens a sign-in window. The user types their work email, then the code from the email, and approves access. Then ask, for example: "The checkout page shows a blank screen on Safari."

A web-based assistant (claude.ai, ChatGPT) must reach your Tikki on the internet. A local client (Claude Code, Cursor, VS Code) can also use `http://localhost:8787/mcp`.

## How sign-in works

For client developers. Tikki follows the MCP authorization spec:

| Step | Endpoint |
|---|---|
| Protected resource metadata | `GET /.well-known/oauth-protected-resource/mcp` |
| Authorization server metadata | `GET /.well-known/oauth-authorization-server/api/auth` (also at `/.well-known/oauth-authorization-server`) |
| Client registration | Client ID Metadata Documents (an `https` URL as `client_id`), or Dynamic Client Registration |
| Authorization | OAuth 2.1 authorization code with PKCE. The user signs in and approves on the consent page. |
| Token | A JWT access token. Its audience is `https://tikki.example.com/mcp`. |

A call without a valid token gets `401` with a `WWW-Authenticate` header that names the resource metadata. Tikki refuses DPoP-bound tokens. A deactivated user's token stops at once.

The transport is Streamable HTTP, stateless: each `POST /mcp` stands alone.

## Tools

The assistant sees only what the user may see. Requesters work on their own tickets. Agents and Admins also change tickets.

| Tool | Who | What it does |
|---|---|---|
| `list_ticket_types` | Everyone | The Ticket Types with id, name, description and prefix |
| `get_ticket_type` | Everyone | The Fields of one type as JSON Schema |
| `create_ticket` | Everyone | Creates a ticket. If similar open tickets exist, it creates nothing and lists them, unless `confirm_new` is true. |
| `list_my_tickets` | Everyone | The tickets the user asked for |
| `get_ticket` | Everyone | One ticket with Fields and the newest comments |
| `search_tickets` | Everyone | Words or a Ticket Reference, with filters. Pages with `next_cursor`. |
| `add_comment` | Everyone | Adds a comment. Agents write internal by default. |
| `attach_text` | Everyone | Attaches text (a log, CSV or stack trace, up to 256 KB) as a file |
| `request_upload_link` | Everyone | A link for the user to upload a binary file. One use, 15 minutes. |
| `change_status` | Agents | Sets the Status |
| `change_priority` | Agents | Sets the Priority |
| `assign_ticket` | Agents | Assigns to `me`, to an Agent by email, or to `none` |
| `move_ticket_team` | Agents | Moves the ticket to another Team |
| `change_ticket_type` | Agents | Moves the ticket to another Ticket Type |

Each write tool tells the assistant to ask the user before it calls the tool.

### Results

- Text that users wrote (titles, descriptions, comments, Field values) is inside `<untrusted_content>` tags, and the result says that the text is data. This protects the assistant against instructions hidden in a ticket.
- An error is a tool result with `isError: true`, and the text says what to do. The assistant can read it and correct the call.
  - Most errors have `structuredContent.error` with `code` and `message`. `RATE_LIMITED` also has `retry_after`.
  - Invalid values (for example a missing required Field in `create_ticket`) have `structuredContent.problems`: one entry for each problem, with `key`, `label` and `reason`.
- Changes show as **AI** in the ticket's Activity, with the user's name.

## Limits

| Limit | Value |
|---|---|
| Tool calls | 30 a minute for each user |
| Write tool calls | 10 a minute for each user, inside the 30 |
| Search page | 20 results, up to 50 with `limit` |
| Comments in `get_ticket` | The newest 20 |

Over a limit, the tool result has the code `RATE_LIMITED` and `retry_after` in seconds.

## Tools in the page (WebMCP)

The ChatGPT desktop app has a built-in browser that calls [WebMCP](https://webmachinelearning.github.io/webmcp/) tools. When a user opens Tikki there and signs in, the page gives the assistant these tools. They use the user's session, so no connector is needed.

| Tool | Where | What it does |
|---|---|---|
| `search_tickets` | Every page | Summaries of the tickets the user may see |
| `open_ticket` | Every page | Opens a ticket in the user's tab |
| `get_ticket_types` | Every page | The Ticket Types and their Fields |
| `create_ticket` | Every page | Creates a ticket, with the same check for similar tickets |
| `get_current_ticket` | Ticket page | The ticket on the screen, with the newest 20 comments |
| `add_comment_to_current_ticket` | Ticket page | Adds a comment to the ticket on the screen |
| `change_current_ticket_status` | Ticket page, Agents | Sets the Status of the ticket on the screen |

The assistant reads a full ticket only when the user's tab shows it. A browser without WebMCP gets no tools and no errors.

## Errors and edge cases

| Situation | What happens | What to do |
|---|---|---|
| The client cannot connect | Most often the client cannot reach your Tikki | A web-based assistant needs a public `https` address. |
| The sign-in window does not open | The client does not support OAuth for remote servers | Update the client, or use another one. |
| `401` after some time | The access token expired | The client refreshes it or asks the user to sign in again. |
| A tool answers `NOT_FOUND` | The ticket does not exist, or the user may not see it | Check the reference. |
| A tool answers `FORBIDDEN` | The user's role cannot do this, for example a Requester changing the Status | Ask an Agent. |
| `RATE_LIMITED` | Too many calls in one minute | Wait `retry_after` seconds. |
