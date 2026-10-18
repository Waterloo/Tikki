# 23 · Rate limits

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

No single key, User, or attacker can overload the instance or abuse sign-in.

- First, confirm that the Cloudflare rate-limiting binding is available on the Workers Free plan, and record the result in DECISIONS.md. If it is not available, use a D1 counter for the sign-in limit only.
- Limits: API key 60 requests/min (10 creates/min); User web 120/min; User through MCP 30 tool calls/min (10 writes/min); sign-in 10/min for each IP. (The limit on email codes for each address already exists from issue 01.)
- Admins can change the limits for each API key on the Application page.
- A limited request gets 429 with `Retry-After`, in the standard error format.

## Acceptance criteria

- [x] The binding check result is in DECISIONS.md section 10 (10.1). Evidence: the docs do not confirm Free-plan or local-test support, so 10.2 uses D1 for all limits.
- [x] REST test: the 61st request in a minute with one key gets 429 with `Retry-After`.
- [x] REST test: a changed limit for one key applies to that key only.
- [x] MCP test: the 11th write in a minute is refused with a clear tool error.
- [x] Sign-in test: the 11th attempt from one IP in a minute is refused.

Tests: `test/worker/rate-limits.test.ts` (8 tests: 61st request, per-Application limit, create limit, create above request limit refused, web User 120, MCP 11th write, MCP 31st call, sign-in 11th). `e2e/applications.spec.ts` changes the limit on the Application page. `pnpm test`: 333 passed. `pnpm typecheck`: clean. `E2E_PORT=8854 pnpm e2e`: 23 passed.

## Not verified

- The Rate limit row and its dialog were checked only by the Playwright test, not looked at in a browser (light/dark, 375 px).
- The sign-in page was not checked with a 429 answer; it gets Better-Auth's `{ code, message }` shape.
- Behaviour on real Cloudflare under load; D1 write cost per request was not measured.
- Requests with a bad or missing API key and unauthenticated requests have no limit (no safe identity to count, and counting them would write to D1 for anonymous traffic).

## Decisions made here

See DECISIONS.md 10.1 to 10.5 (D1 fixed-window counter instead of the binding; limits per Application, not per key; where each limit applies; `RATE_LIMITS=off` for dev and e2e only). Migration `0017_issue_23_rate_limits`: table `rate_counter`, columns `application.rate_limit` and `application.create_limit`.

## Notes for later issues

- New limited routes need no work: REST goes through `restPrincipal`/`sessionPrincipal`, MCP tools through `registerTool`. A route that reads the session by itself must call `takeSlot` (`server/utils/rate-limit.ts`).
- A new MCP tool without `readOnlyHint: true` counts as a write.
- Tests: `call()` adds a random `CF-Connecting-IP`; send your own to test a per-IP limit.

## Blocked by

- [12 · Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md)
