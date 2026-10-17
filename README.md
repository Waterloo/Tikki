# Ticketing

A self-hosted ticketing system on one Cloudflare Worker. People raise tickets in the web app, through Claude (an MCP custom connector), and through a REST API.

Read [docs/PRD.md](docs/PRD.md), [docs/DECISIONS.md](docs/DECISIONS.md) and [CONTEXT.md](CONTEXT.md) (the glossary) first. Decisions after 2026-10-18 are in [docs/adr](docs/adr).

## Status

Issue 01 (walking skeleton): email-code sign-in, the Claude connector (OAuth 2.1 + MCP) with one tool, `create_ticket`, and a list of the signed-in User's tickets.

## Layout

| Path | What it is |
|---|---|
| `app/` | Nuxt 4 SPA (`ssr: false`): sign-in, OAuth consent, My tickets |
| `server/utils/config.ts` | Reads and checks the environment. A bad value stops the Worker at startup |
| `server/utils/auth.ts` | Better-Auth: email OTP, domain allow list, code limit, bootstrap Admin, OAuth server for MCP |
| `server/utils/mcp.ts` | Stateless MCP endpoint (`/mcp`) and its token check |
| `server/utils/tickets.ts` | Tickets module, used by REST and MCP |
| `server/api/v1/` | REST API |
| `server/db/` | Drizzle schema. `auth-schema.ts` is generated |
| `migrations/` | D1 migrations, forward-only |
| `test/worker/` | Tests in the Workers runtime against the built Worker, with local D1 |
| `test/startup/` | Tests that start the built Worker with bad configuration |

## Local development

Needs Node 22+ and pnpm 10.

```bash
pnpm install
```

```bash
cp .dev.vars.example .dev.vars
```

Put a secret in `.dev.vars` (`openssl rand -base64 32`). Then:

```bash
pnpm db:migrate:local
```

```bash
pnpm dev
```

Open http://localhost:8787 and sign in with an address at `example.com` (the allow list in `wrangler.jsonc`). The sign-in email, with its code, shows in the `wrangler dev` output. `admin@example.com` becomes the Admin on its first sign-in.

To try the connector locally, point an MCP client at `http://localhost:8787/mcp`. claude.ai cannot reach localhost; use staging for that.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `APP_ENV` | yes | `development`, `test`, `staging` or `production` |
| `APP_URL` | yes | The origin, for example `https://tickets.example.com`. The MCP URL is `{APP_URL}/mcp` |
| `BETTER_AUTH_SECRET` | yes (secret) | At least 32 characters |
| `ALLOWED_EMAIL_DOMAINS` | yes | Comma-separated domains that can sign in. Subdomains do not match |
| `MAIL_TRANSPORT` | yes | `cloudflare`; `console` only in development; `capture` only in tests |
| `MAIL_FROM` | with `cloudflare` | Sender address on the domain onboarded to Cloudflare Email Sending |
| `ADMIN_EMAIL` | no | The first sign-in with this address becomes Admin. No effect after an Admin exists |

Bindings: `DB` (D1), `EMAIL` (`send_email`, with `cloudflare`), `ASSETS`.

## Tests

```bash
pnpm test
```

This builds the Worker, then runs Vitest in the Workers runtime (`@cloudflare/vitest-plugin`) with local D1. The tests drive the Worker through HTTP only: sign-in with captured emails, the full OAuth flow (DCR, PKCE, consent, token), an MCP client calling `create_ticket`, and the REST API.

```bash
pnpm typecheck
```

## Database changes

1. Change `server/db/schema.ts`. If you change Better-Auth plugins or fields, run `pnpm auth:generate` first.
2. Run `pnpm db:generate` to write a new migration. Never edit a migration that is on `main`.
3. Run `pnpm db:migrate:local`.

## Deploy

CI (`.github/workflows/ci.yml`) runs the type check and the tests on each pull request. On each merge to `main`, it applies the D1 migrations to staging and deploys the Worker to staging. The setup steps are in [issue 01](docs/issues/01-walking-skeleton.md#manual-setup-owner).
