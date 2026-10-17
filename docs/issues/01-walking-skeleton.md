# 01 · Walking skeleton: Claude creates a ticket

**Type:** HITL (Cloudflare account setup, Cloudflare Email Sending on the sending domain, manual claude.ai connection)
**Labels:** —

## Parent

[docs/PRD.md](../PRD.md)

## What to build

The thinnest system that works from start to end on the real platform. A User signs in with a code from their email, adds the instance to claude.ai as a custom connector, writes one sentence, and Claude creates a ticket that the User then sees in the web app.

- One Cloudflare Worker serves the Nuxt 4 SPA (`ssr: false`), a minimal REST endpoint, and the MCP endpoint.
- D1 with Drizzle migrations. The first migration creates the Better-Auth tables, one seeded Ticket Type "Bug" with prefix `BUG` and no Fields, and the tickets table with the global counter.
- The mail transport, one `send(message)` function with three implementations: Cloudflare Email (staging and production), `console` (local development: the email, with its code, is written to the `wrangler dev` output), and a capturing one for tests. The Worker refuses to start with `console` outside the development environment.
- Better-Auth 1.7 with **email OTP** as the only sign-in method (no magic links, no passwords), the domain allow list, and the bootstrap Admin from `ADMIN_EMAIL`. The Worker refuses to start when the allow list is missing.
- Rate limit on codes: 5 for each email address in an hour.
- Better-Auth as the OAuth 2.1 authorization server for MCP (`@better-auth/mcp`, `@better-auth/cimd`, DCR fallback, legacy stateless mode on). The protected-resource metadata and the 401 `WWW-Authenticate` header follow the Claude connector rules in DECISIONS.md section 2. The code sign-in must work inside the Claude OAuth popup.
- A stateless MCP handler with one tool, `create_ticket` (title, description), marked as a write tool.
- One web page that lists the signed-in User's tickets with their Ticket Reference.
- GitHub Actions: on merge to `main`, run the migrations and deploy to the `staging` environment.

## Acceptance criteria

- [ ] In local development, the sign-in code shows in the `wrangler dev` output, and the User can sign in with it.
- [ ] The Worker fails at startup with a clear error when the transport is `console` and the environment is not development.
- [ ] The Worker fails at startup with a clear error when the allow list is missing.
- [ ] A User with an allowed email gets a code and signs in. An email from another domain gets no code.
- [ ] The 6th code request in an hour for one address is refused.
- [ ] The first sign-in with `ADMIN_EMAIL` gets the Admin role. Later sign-ins with other emails get Requester.
- [ ] On staging, a real code email arrives through Cloudflare Email.
- [ ] claude.ai connects to the staging MCP URL as a custom connector, and the OAuth flow with the code completes in the popup (checked by hand and written down in this issue).
- [ ] In Claude, "raise a bug: the export button fails" creates `BUG-1` within 10 seconds, after Claude asks for confirmation.
- [ ] The ticket shows in the web list for that User.
- [ ] A merge to `main` deploys to staging and runs the migrations without manual steps.
- [ ] API-seam test: an MCP client with a test token calls `create_ticket`, and the ticket can be read back through the REST endpoint.
- [ ] Notes on the risks from PRD "Further Notes" (CIMD transport, protocol version, well-known routes) are recorded, with what worked.

## Manual setup (owner)

- [ ] Cloudflare account on the Workers Paid plan.
- [ ] Sending domain on Cloudflare DNS, onboarded to Cloudflare Email Sending (SPF, DKIM, DMARC added by the dashboard).
- [ ] GitHub repository with Cloudflare API token secrets for CI.
- [ ] Values for `ADMIN_EMAIL` and `ALLOWED_EMAIL_DOMAINS` on staging.

## Blocked by

None. This issue can start immediately.
