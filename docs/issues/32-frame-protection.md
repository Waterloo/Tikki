# 32 · No framing of Tikki by other sites

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Found while planning Ticket Apps (issues 34, 35), 2026-10-18.

## What to build

Tikki sends no `Content-Security-Policy` and no `X-Frame-Options`. Any site can load Tikki in a frame and trick a signed-in Agent into a click (clickjacking).

- Every response says that no site may frame Tikki: `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- The SPA pages are static assets. The Worker does not run for them (`run_worker_first` covers only `/api/*`, `/mcp`, `/.well-known/*`). So the headers for them come from a `_headers` file in the static output. The Worker responses get the same headers from one place in the server.
- Only `frame-ancestors` is set. Do not add `frame-src` or `default-src`: issue 34 frames apps from Admin-configured origins, and a static `_headers` file cannot list them.
- The upload page (`/upload/[token]`) and the OAuth consent page are covered too. They are the pages a clickjacker would want most.

## Acceptance criteria

- [ ] Test: `/`, `/tickets/X`, `/consent`, `/upload/x`, an `/api/v1/...` response and `/mcp` have both headers. The test runs against `wrangler dev`, because the Workers test runtime does not serve static assets.
- [ ] Playwright: a page on another port that frames `http://localhost:<port>/` shows nothing (the frame is blocked).
- [ ] The app still works in a browser: sign-in, ticket page, file upload (no CSP errors in the console).

## Blocked by

None.
