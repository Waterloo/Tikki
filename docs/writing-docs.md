# Writing the developer docs

The developer docs at `/docs` are for people who build on Tikki: Ticket Apps, the REST API, webhooks and MCP. They are not a user manual. The build (`scripts/docs-site/`) makes static HTML from the Markdown files below and the OpenAPI document.

## Philosophy

A developer comes with a task and little time. Good docs get them to a working result fast, and then answer every question that the result raises.

1. **Start from the task.** Each page opens with what you can build and a complete example. The first success (a ticket made, a token checked, a signed Event received) comes before the detail.
2. **Show, then explain.** Every concept has code that runs as it is: curl and JavaScript. Examples use the address of the instance that serves the docs, so copy and paste works.
3. **One source of truth.** Pages come from the files the code uses: the OpenAPI document, the Markdown guides, the tool lists. Tests fail when the docs and the code disagree. Never copy a fact into two places.
4. **Exact numbers.** Limits, times, sizes, status codes and error codes are written as values: "5 minutes", "120–600 px", `429` with `Retry-After`. Never "short" or "a few".
5. **The unhappy path is part of the docs.** Each guide, or the reference page under it, has a table of errors and edge cases with what to do. Each API operation lists every status it can answer.
6. **Safe by default.** Examples check signatures, origins and audiences. A reader who copies the example gets the secure version.
7. **Easy to scan.** Headings name tasks. Reference data goes in tables. Short sentences in ASD-STE100 Simplified Technical English.
8. **Links to working code.** Each guide links to an example app, the OpenAPI document and the raw Markdown (also `/docs/llms.txt` for AI assistants).
9. **Fast and quiet.** Static pages, no tracking, no external requests. Without JavaScript every page still reads; JavaScript adds search, tabs, copy and the theme switch.

## Pages and sources

| Page | Source |
|---|---|
| `/docs/` | `scripts/docs-site/pages.ts` (the home page) |
| `/docs/ticket-apps` | [docs/ticket-apps.md](ticket-apps.md) |
| `/docs/ticket-apps-reference` | [docs/ticket-apps-reference.md](ticket-apps-reference.md) |
| `/docs/webhooks` | [docs/webhooks.md](webhooks.md) |
| `/docs/ai` | [docs/ai-assistants.md](ai-assistants.md) |
| `/docs/api` | `buildOpenApiDocument()` in `server/utils/openapi.ts`, with its examples |

Each page is also at `/docs/<page>.md`. The sidebar and "On this page" come from the `##` and `###` headings.

## Markdown conventions

- **Callouts:** a blockquote is a note. `> [!WARNING]` as its first line makes a warning. GitHub shows both.
- **Language tabs:** code blocks that follow each other with a `tab=` label become one block with tabs. Quote a label with a space: `tab="Node.js crypto"`.

  ````md
  ```bash tab=curl
  curl ...
  ```
  ```js tab=JavaScript
  await fetch(...)
  ```
  ````

- **Diagrams:** draw them as SVG files in `docs/assets/` and show them with `![text for screen readers](assets/name.svg)`. The build puts the SVG inline, so it takes the page colors and the theme switch. Scope its `<style>` rules to one class (see `ticket-apps-flow.svg`), and give each color a fallback for GitHub. No other images: the build fails on them. Do not draw diagrams with box characters; they do not line up in every font.
  - **Step-through:** give the `<svg>` `data-steps="N"`, put each step in `<g class="step step-1">` … with one `data-path` for the moving dot, and follow the image with a numbered list of the same N steps. The page adds **Play the steps**, and pointing at a list item highlights its step. See `ticket-apps-flow.svg`.
- **The instance address:** write `https://tikki.example.com`. The page shows the address of the instance that serves it.
- **Links:** link other guides by file name (`webhooks.md#retries`). The build turns them into docs links. Links to other files in the repository go to GitHub. A site path such as `/docs/api` stays as it is: it works on the docs site, not on GitHub, so use it only for pages that have no Markdown file.
- **A guide and its reference:** a long guide can have a reference page (`parent` in `GUIDES`, `scripts/docs-site/build.ts`). The guide teaches by task and links to the reference for exact values. Do not repeat a value in both: write it in the reference and link to it.
- **API examples** live in the OpenAPI document (`example` on each request and response). A test parses each one with the schema it shows.
