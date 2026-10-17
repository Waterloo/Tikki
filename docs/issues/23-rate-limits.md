# 23 · Rate limits

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

No single key, User, or attacker can overload the instance or abuse sign-in.

- First, confirm that the Cloudflare rate-limiting binding is available on the Workers Free plan, and record the result in DECISIONS.md. If it is not available, use a D1 counter for the sign-in and OTP limits only.
- Limits: API key 60 requests/min (10 creates/min); User web 120/min; User through MCP 30 tool calls/min (10 writes/min); sign-in 10/min for each IP.
- Admins can change the limits for each API key on the Application page.
- A limited request gets 429 with `Retry-After`, in the standard error format.

## Acceptance criteria

- [ ] The binding check result is in DECISIONS.md section 10.
- [ ] REST test: the 61st request in a minute with one key gets 429 with `Retry-After`.
- [ ] REST test: a changed limit for one key applies to that key only.
- [ ] MCP test: the 11th write in a minute is refused with a clear tool error.
- [ ] Sign-in test: the 11th attempt from one IP in a minute is refused.

## Blocked by

- [12 · Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md)
