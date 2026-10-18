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

- [x] Test: `/`, `/tickets/X`, `/consent`, `/upload/x`, an `/api/v1/...` response and `/mcp` have both headers. The test runs against `wrangler dev`, because the Workers test runtime does not serve static assets.
  Evidence: `e2e/frame-protection.spec.ts` (also `/sign-in`, `/.well-known/*`, and a `PUT /api/v1/attachments` response); checked with curl on `wrangler dev` too. `test/worker/frame-headers.test.ts` checks the helper and that `public/_headers` matches it.
- [x] Playwright: a page on another port that frames `http://localhost:<port>/` shows nothing (the frame is blocked).
  Evidence: last test in `e2e/frame-protection.spec.ts` (the frame ends on Chromium's error page).
- [x] The app still works in a browser: sign-in, ticket page, file upload (no CSP errors in the console).
  Evidence: the full e2e suite (sign-in, tickets, attachments) passes. `frame-ancestors` only limits who frames the app, so it cannot cause console CSP errors. Not seen by eye.

## Blocked by

None.

## Not verified

- Production Workers static assets with `_headers`. Verified only on `wrangler dev` (local), where `nuxt build` merges `public/_headers` into `.output/public/_headers`.
- No visual check in a browser pane.

## Decisions made here

- The Worker adds the headers in one place: the custom entry `server/entry.ts`, through `withFrameHeaders`. It wraps both the upload route and Nitro, so no route can miss them.
- The constants live in `server/utils/frame-headers.ts`; `public/_headers` repeats them. A Vitest test fails if they differ.
- `_headers` uses `/*`. It also reaches `/_nuxt/*` and fonts; harmless.

## Notes for later issues

- Issue 34 frames external apps from Tikki. That needs `frame-src` or `child-src` on Tikki pages, which a static `_headers` file cannot hold. Keep `frame-ancestors` separate when you add it, because `_headers` and `withFrameHeaders` set `Content-Security-Policy` as a whole.

## Glossary terms to add

None.
