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

Checked items pass in the automated tests or were checked by hand in local development on 2026-10-18. Unchecked items need the staging setup below and a person.

- [x] In local development, the sign-in code shows in the `wrangler dev` output, and the User can sign in with it. (`e2e/sign-in.spec.ts`, "sign in with the emailed code and see My tickets", reads the code from the server output. Also checked by hand in the browser.)
- [x] The Worker fails at startup with a clear error when the transport is `console` and the environment is not development. (`test/startup/startup.test.ts`)
- [x] The Worker fails at startup with a clear error when the allow list is missing. (`test/startup/startup.test.ts`)
- [x] A User with an allowed email gets a code and signs in. An email from another domain gets no code. (`test/worker/sign-in.test.ts`)
- [x] The 6th code request in an hour for one address is refused. (`test/worker/sign-in.test.ts`, [ADR 0001](../adr/0001-otp-limit-in-d1.md))
- [x] The first sign-in with `ADMIN_EMAIL` gets the Admin role. Later sign-ins with other emails get Requester. (`test/worker/bootstrap-admin.test.ts`)
- [ ] On staging, a real code email arrives through Cloudflare Email.
- [ ] claude.ai connects to the staging MCP URL as a custom connector, and the OAuth flow with the code completes in the popup (checked by hand and written down in this issue).
- [ ] In Claude, "raise a bug: the export button fails" creates `BUG-1` within 10 seconds, after Claude asks for confirmation.
- [x] The ticket shows in the web list for that User. (The list reads `GET /api/v1/tickets?requester=me`; `test/worker/mcp.test.ts` reads a ticket made through MCP back from that endpoint. The page was checked by hand.)
- [ ] A merge to `main` deploys to staging and runs the migrations without manual steps. (The workflow is ready in `.github/workflows/ci.yml`; it needs the setup below and a first merge.)
- [x] API-seam test: an MCP client with a test token calls `create_ticket`, and the ticket can be read back through the REST endpoint. (`test/worker/mcp.test.ts`, for the 2025 and the 2026-07-28 protocol)
- [x] Notes on the risks from PRD "Further Notes" (CIMD transport, protocol version, well-known routes) are recorded, with what worked. (See "Risk notes" below.)

## Manual setup (owner)

Do these steps once. The values in `CAPITALS` go into the GitHub environment in step 5.

- [ ] **1. Cloudflare account on the Workers Paid plan.**
  1. In the Cloudflare dashboard, go to **Workers & Pages → Plans** and choose **Workers Paid**.
  2. On the **Workers & Pages** overview page, copy the **Account ID** (right column). This is `CLOUDFLARE_ACCOUNT_ID`.
  3. Under **Workers & Pages → Account details**, note your `workers.dev` subdomain. The staging URL is `https://ticketing-staging.<subdomain>.workers.dev`. This is `STAGING_APP_URL` (no trailing slash).

- [ ] **2. Sending domain on Cloudflare DNS, onboarded to Cloudflare Email Sending.**
  1. The domain must use Cloudflare nameservers (**Add a domain**, then change the nameservers at your registrar).
  2. Open the domain, go to **Email → Email Sending**, and onboard the domain. Add every DNS record that the dashboard shows (SPF, DKIM, DMARC). Wait until the domain shows as verified.
  3. Choose a sender address on that domain, for example `tickets@<domain>`. This is `STAGING_MAIL_FROM`.

- [ ] **3. Staging D1 database.** On your computer, in this repository:
  ```bash
  pnpm wrangler login
  ```
  ```bash
  pnpm wrangler d1 create ticketing-staging
  ```
  Copy the `database_id` from the output. This is `STAGING_D1_DATABASE_ID`. Do not apply migrations by hand; CI does it.

- [ ] **4. Cloudflare API token for CI.**
  1. Go to **My Profile → API Tokens → Create Token**, and start from the **Edit Cloudflare Workers** template.
  2. Add the permission **Account → D1 → Edit**.
  3. Limit **Account Resources** to your account. Create the token and copy it. This is `CLOUDFLARE_API_TOKEN`.
  4. If the first deploy fails with an authorization error about the `send_email` binding, edit the token and add the email sending permission that the error names.

- [ ] **5. GitHub repository with the CI values.**
  1. Push this repository to GitHub.
  2. Go to **Settings → Environments → New environment**, and name it `staging`.
  3. Add these **environment secrets**:
     - `CLOUDFLARE_API_TOKEN` (step 4)
     - `CLOUDFLARE_ACCOUNT_ID` (step 1)
     - `STAGING_BETTER_AUTH_SECRET`: the output of `openssl rand -base64 32`. Do not change it later: a change signs out every User and makes all issued tokens invalid.
  4. Add these **environment variables**:
     - `STAGING_D1_DATABASE_ID` (step 3)
     - `STAGING_APP_URL` (step 1), for example `https://ticketing-staging.<subdomain>.workers.dev`
     - `STAGING_MAIL_FROM` (step 2)
     - `STAGING_ALLOWED_EMAIL_DOMAINS`: the domains that can sign in, comma-separated, for example `example.com`
     - `STAGING_ADMIN_EMAIL`: your own address. Its first sign-in becomes Admin.
  5. Merge to `main`, or run **Actions → CI → Run workflow** on `main`. The `deploy-staging` job first lists any missing value by name.

- [ ] **6. Checks by hand after the first deploy.** Write the result and the date under "Manual check results".
  1. Open `STAGING_APP_URL`, enter `STAGING_ADMIN_EMAIL`, and check that the code email arrives. Sign in.
  2. In claude.ai, go to **Settings → Connectors → Add custom connector**. Name: `Tickets`. URL: `STAGING_APP_URL` + `/mcp`. Select **Connect**.
  3. In the popup, enter your email, then the code from the email, then select **Allow**. The popup must close and the connector must show as connected.
     - If the popup shows `invalid_client`, copy the `client_id` from the popup URL. If it is an `https://` URL, add its host to `CIMD_ALLOWED_HOSTS` in `server/utils/cimd-fetch.ts` ([ADR 0002](../adr/0002-cimd-on-workers.md)).
  4. In a new chat with the connector on, write: `raise a bug: the export button fails`. Claude must ask for confirmation, then reply with `BUG-1` (or the next number) within 10 seconds.
  5. Reload `STAGING_APP_URL`. The ticket must show in **My tickets** with the source "Claude".
  6. Wait more than one hour, then use the connector again. It must work without a new sign-in (refresh token rotation).

### Manual check results

- **2026-10-18, local (`wrangler dev`), Claude Code as the MCP client:** Claude Code registered through CIMD (`https://claude.ai/oauth/claude-code-client-metadata`) after the fix in commit `0272237`. Sign-in with the email code and consent worked in the browser. `create_ticket` created `BUG-2` with channel `ai`. The claude.ai check (step 6) still waits for staging.

## Risk notes

Results from 2026-10-18, in local development (`wrangler dev`) and in the Workers test runtime. The real claude.ai check is step 6 above.

- **Better-Auth OAuth server for MCP.** `@better-auth/mcp` 1.7.10 with `jwt()` works on Workers with D1 (`nodejs_compat`, Drizzle `transaction: false`). The tests run the full flow that Claude uses: DCR, authorize with PKCE S256 and `resource`, sign-in with the email code, consent, code exchange, MCP calls with the access token, and refresh. Access tokens are JWTs with `aud` equal to the MCP URL. Refresh tokens rotate, and a bad refresh token gets `400 invalid_grant`.
- **Sign-in inside the OAuth popup.** The authorize endpoint sends a signed-out User to `/sign-in` with a signed query. The `oauthProviderClient` plugin sends that query with the code sign-in, and Better-Auth continues to `/consent` and then to the client callback. Checked by hand in a browser, up to the callback URL with `code` and `state`.
- **CIMD transport.** `@better-auth/cimd` ships a transport for Node only. Workers cannot pin a resolved address, so our transport fetches only from `claude.ai` and `claude.com` ([ADR 0002](../adr/0002-cimd-on-workers.md)). Discovery advertises `client_id_metadata_document_supported: true`. DCR is on as the fallback. Not checked against claude.ai yet.
- **Protocol version.** `createMcpHandler` from `@modelcontextprotocol/server` 2.3.1 runs with `legacy: 'stateless'`, so 2025-era clients (`initialize` handshake) work, and 2026-07-28 clients work too. The test calls `create_ticket` with both.
- **Well-known routes.** Better-Auth serves the metadata from plugin `onRequest` hooks, so the Worker sends every `/.well-known/*` request to the Better-Auth handler. Served URLs:
  - `/.well-known/oauth-protected-resource/mcp` (and `/.well-known/oauth-protected-resource`): `resource` is exactly `{APP_URL}/mcp`.
  - `/.well-known/oauth-authorization-server/api/auth` (RFC 8414 path insertion), plus the bare `/.well-known/oauth-authorization-server` as an alias for clients that ignore the issuer path.
  - `/api/auth/.well-known/openid-configuration`, plus the bare `/.well-known/openid-configuration` alias.
  - A request to `/mcp` without a valid token gets `401` with `WWW-Authenticate: Bearer resource_metadata="{APP_URL}/.well-known/oauth-protected-resource/mcp"`.
- **Token check.** `requireMcpAuth` fetches the JWKS from the Worker's own URL. We check tokens against the keys in D1 instead ([ADR 0003](../adr/0003-mcp-token-check-with-local-jwks.md)).
- **Redirects for `fetch` clients.** Better-Auth answers `fetch` requests (`Sec-Fetch-Mode: cors`, which Node's `fetch` also sends) with `{ redirect: true, url }` JSON instead of a 302. Browser navigations get a 302. The pages follow the JSON `url`.
- **CPU.** Not measured yet; issue 02 measures each route on staging. Steps taken for the budget: one Better-Auth instance for each isolate, zod in `jitless` mode (Workers forbid `new Function`), codes stored as SHA-256 hashes, and static files served by Workers assets without the Worker. The Worker bundle is about 520 KiB gzip.

## Blocked by

None. This issue can start immediately.
