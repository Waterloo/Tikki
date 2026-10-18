# 41 · Developer docs site at /docs

**Type:** AFK
**Labels:** `done`

## Parent

Owner request, 2026-10-18: a polished HTML docs site for developers, served by Tikki, in place of the raw Markdown link at `/api/docs/ticket-apps.md`. Design approved on the canvas (Tikki developer docs). Philosophy and conventions: [docs/writing-docs.md](../writing-docs.md).

## What was built

- Static pages at `/docs/` (home), `/docs/ticket-apps`, `/docs/webhooks`, `/docs/ai`, `/docs/api`, made at build time by `scripts/docs-site/` in the Nitro `compiled` hook. Workers static assets serve them: no Worker CPU, no sign-in. `public/_headers` (`/*`) gives them the frame headers of issue 32.
- Sources: `docs/ticket-apps.md` (unchanged), new `docs/webhooks.md` and `docs/ai-assistants.md`, and `buildOpenApiDocument()` for the API reference. Each guide is also at `/docs/<page>.md`; `/docs/llms.txt` lists them for AI assistants.
- The OpenAPI document gets `tags` and an `example` on each request body, success response and main error, and on each path parameter. The reference builds curl and `fetch` calls from them.
- Search over every `##`/`###` section (`/docs/search.json`, ⌘K or `/`), language tabs that hold across blocks and visits, copy buttons, "Copy page as Markdown", light and dark mode with the web app's storage key, a menu at phone width.
- Examples are written with `https://tikki.example.com`; the page shows the address of the instance that serves it, also in copied code.
- `/api/docs/ticket-apps.md` answers `301` to `/docs/ticket-apps.md`.
- Links: admin Ticket Apps ("Read the developer guide"), Applications and Webhooks ("Developer docs"), Settings ("Developers" section), README.

## Acceptance criteria

- [x] Pages are generated from the Markdown and the OpenAPI document, so they never drift. Evidence: `test/unit/docs-site.test.ts` builds the site and checks every link and anchor, every operation, every example against its zod schema, and the MCP and WebMCP tool tables against `registerTool` in `server/utils/mcp.ts` and `app/utils/webmcp.ts`.
- [x] Public, with the frame headers. Evidence: `e2e/docs.spec.ts` ("every docs page is public and cannot be framed").
- [x] Linked from the admin Ticket Apps page, Applications, Webhooks, Settings and the README. Evidence: `e2e/docs.spec.ts` ("links from the app"), `e2e/ticket-apps.spec.ts`.
- [x] 375 px and desktop, light and dark. Evidence: `e2e/docs.spec.ts` (no sideways scroll on every page at 375 and 1440 in both modes); seen in the browser pane on the dev server.
- [x] Changes to `docs/ticket-apps.md` show on the next build with no other change. The sidebar and "On this page" come from its headings.

## Not verified

- Production Workers static assets: seen only on `wrangler dev`. `/docs` answers `307` to `/docs/` there (the default `html_handling`).
- Screen readers: not tried.

## Decisions made here

- Static HTML from a build hook, not Nuxt pages: the docs need no app code, load fast, and cost no Worker CPU.
- `marked` and `shiki` are dev dependencies; `geist` gives the font files. Nothing new ships to the Worker.
- The docs CSS takes the `:root` and `.dark` blocks of `app/assets/css/main.css` at build time, so the colors and radius cannot drift.
- Examples in the OpenAPI document, not in a separate file: Postman and code generators get them too, and the test checks them with the same schemas.
- The default per-Application limits on `/docs/api` are read from `server/utils/rate-limit.ts` at build time.
- Links from a guide to other repository files go to GitHub (`REPO` in `scripts/docs-site/markdown.ts`); the test checks that each file exists.
- A guide's `## Contents` section is left out of the HTML page, because "On this page" replaces it. It stays for GitHub.
- The name stays "Tikki Docs" (owner asked about "Tikki Apps"): the site also covers the REST API, webhooks and MCP.

## Glossary terms to add

None.

## Notes for later issues

- Issues 37–40 change `docs/ticket-apps.md`. The docs pick it up. If they add a code block in a new language, add it to `LANGS` in `scripts/docs-site/markdown.ts` (the build fails and names it).
- The context-token routes (comments, activity, `PATCH` with a Ticket App token) are only in the guide. Adding them to the OpenAPI document with their own security scheme would put them in the reference too.
- Renaming "Ticket Apps" to "Tikki Apps" or "Apps" fits once app pages (issue 39) exist; it is a domain rename (CONTEXT.md, UI, API paths), not a docs change.
