# 21 · Settings, branding, and the first-run screen

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Admins brand the instance and see its configuration, and a new install shows its value at once. Screens: "Settings" and "First run" on the design canvas.

- Settings: organization name, subtitle, logo (PNG only, 1 MB maximum; SVG refused because it can contain script; fallback is the first letter of the name).
- Ticket numbers section: explanation only. Prefixes are set on each Ticket Type.
- Deployment section, read-only: address, connector URL with copy, sign-in methods and allow list, Deploy Profile, email sender.
- First-run screen for the first Admin: connector URL with copy, a suggested first message for Claude, "waiting for your first ticket", the example types, allowed domains, and a link to create an API key.

## Acceptance criteria

Checked on 2026-10-18. `pnpm test` (100 tests, 10 files) and `pnpm typecheck` pass.

- [x] REST test: an SVG or a file above 1 MB is refused as a logo. Evidence: `test/worker/settings.test.ts` ("refuses an SVG as a logo..." returns 415, "refuses a logo above 1 MB..." returns 413 and accepts exactly 1 MB).
- [x] REST test: only Admins can change settings. Evidence: `test/worker/settings.test.ts` ("lets only Admins change settings": 401 without a session, 403 for a Requester on name, logo, deployment and setup routes).
- [x] The first Admin sees the first-run screen until the first ticket exists, and the normal list after that. Evidence: the REST test "reports that no ticket exists until the first ticket..." covers the state; by hand against `wrangler dev`, an Admin on a database without tickets saw the first-run screen. The switch to the list after the first ticket is by code (the screen polls every 5 s and on a ticket loads the list) and was not seen in the browser.
- [ ] Playwright flow: an Admin changes the name, and the sidebar shows it. Not done as Playwright: the project has no Playwright setup, and this issue does not add one. Done by hand instead in the browser against `wrangler dev`: an Admin saved "Acme Support" and the sidebar menu showed it, with the letter "A" as the fallback mark. The sign-in page reads the same public endpoint; it was not re-opened after the change.

## Not verified

- Logo upload through the browser file picker (the REST tests cover the API; the page was not driven with a real file).
- Dark and light mode of the new screens at desktop width; only a 400 px wide pane was checked, in dark mode.
- Copy buttons need `navigator.clipboard`; the click was not exercised.
- CPU time of each route was not measured. Each route does one or two small D1 queries and no parsing beyond a 1 MB bound, but this is by design and not by measurement.

## Decisions made here

- **Logo in D1, not R2.** R2 is not bound yet. A PNG of at most 1 MB is a D1 blob in the single `organization` row (D1 allows 2 MB for a row). The Worker serves it at `/api/v1/organization/logo?v=<version>` with `nosniff`, a sandbox CSP and a one-year cache, because the version changes with the logo. Only the logo routes read the blob; the name query does not select it. Move it to R2 when the binding exists.
- **Name, subtitle and logo are public to read.** The sign-in page shows them before anyone signs in, so `GET /api/v1/organization` and the logo need no session. Changing them needs an Admin.
- **Checks on the logo:** content type `image/png`, size at most 1 MiB (the body is read with a bound), and the 8-byte PNG signature. An SVG fails the first check, and an SVG sent as `image/png` fails the third.
- **No link to create an API key** on the first-run screen. API keys come in issue 12 and there is no page to link to; add the link there.
- Routes: `GET/PATCH /api/v1/organization`, `PUT/DELETE/GET /api/v1/organization/logo`, `GET /api/v1/settings/deployment` (Admin), `GET /api/v1/setup` (Admin, first-run data).
- Migration `0002_wild_bloodstrike.sql` adds the `organization` table and seeds the row with the earlier fixed values ("Ticketing", "Support desk").

## Blocked by

- [03 · Ticket Types with Fields](03-ticket-types-with-fields.md)
