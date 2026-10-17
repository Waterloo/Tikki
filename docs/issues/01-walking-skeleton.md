# 01 · Walking skeleton: Claude creates a ticket

**Type:** HITL (Cloudflare account setup, Google OAuth client, manual claude.ai connection)
**Labels:** —

## Parent

[docs/PRD.md](../PRD.md)

## What to build

The thinnest system that works from start to end on the real platform. A signed-in User adds the instance to claude.ai as a custom connector, writes one sentence, and Claude creates a ticket that the User then sees in the web app.

- One Cloudflare Worker serves the Nuxt 4 SPA (`ssr: false`), a minimal REST endpoint, and the MCP endpoint.
- D1 with Drizzle migrations. The first migration creates the Better-Auth tables, one seeded Ticket Type "Bug" with prefix `BUG` and no Fields, and the tickets table with the global counter.
- Better-Auth 1.7: Google sign-in only, the domain allow list, and the bootstrap Admin from `ADMIN_EMAIL`. The Worker refuses to start when Google is on and the allow list is missing.
- Better-Auth as the OAuth 2.1 authorization server for MCP (`@better-auth/mcp`, `@better-auth/cimd`, DCR fallback, legacy stateless mode on). The protected-resource metadata and the 401 `WWW-Authenticate` header follow the Claude connector rules in DECISIONS.md section 2.
- A stateless MCP handler with one tool, `create_ticket` (title, description), marked as a write tool.
- One web page that lists the signed-in User's tickets with their Ticket Reference.
- GitHub Actions: on merge to `main`, run the migrations and deploy to the `staging` environment.

## Acceptance criteria

- [ ] A User with an allowed email signs in with Google. A User with another domain is refused.
- [ ] The first sign-in with `ADMIN_EMAIL` gets the Admin role. Later sign-ins with other emails get Requester.
- [ ] Without the allow list, the Worker fails at startup with a clear error message.
- [ ] claude.ai connects to the staging MCP URL as a custom connector, and the OAuth flow completes (checked by hand and written down in the issue).
- [ ] In Claude, "raise a bug: the export button fails" creates `BUG-1` within 10 seconds, after Claude asks for confirmation.
- [ ] The ticket shows in the web list for that User.
- [ ] A merge to `main` deploys to staging and runs the migrations without manual steps.
- [ ] API-seam test: an MCP client with a test token calls `create_ticket` and the ticket can be read back through the REST endpoint.
- [ ] Notes on the risks from PRD "Further Notes" (CIMD transport, protocol version, well-known routes) are recorded, with what worked.

## Blocked by

None. This issue can start immediately.
