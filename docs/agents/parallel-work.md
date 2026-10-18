# Parallel work

Read this before you start work next to other agents, and before you write a migration. Several agents build separate issues at the same time, each in its own git worktree. The lead merges the branches. Module map: [architecture.md](../architecture.md). Review rules: [CODING_STANDARDS.md](../../CODING_STANDARDS.md).

## Where you work

- Work only in your worktree. Never `cd` to the main checkout or to another worktree. Never touch `main` or `integration`.
- Commit on your own branch. Do not push. Do not merge.
- Never use bare `git stash`: the stack is shared by all worktrees. Use a WIP commit.
- One worktree and one port pair for each agent: `DEV_PORT` and `E2E_PORT`. The lead assigns them. Two agents on one port serve each other's build.
- For a long run, keep the Mac awake (`caffeinate -dimsu`).

## Ports and commands

- Dev server (background): `pnpm exec nuxt build && pnpm exec wrangler d1 migrations apply DB --local --persist-to .wrangler/dev && pnpm exec wrangler dev --port <DEV_PORT> --var APP_URL:http://localhost:<DEV_PORT> --persist-to .wrangler/dev`. Use a persist directory that is yours alone.
- Sign-in codes print in the server output. The Admin is `admin@example.com`; other `@example.com` addresses become Requesters.
- e2e: `E2E_PORT=<E2E_PORT> pnpm e2e`. It also starts the test Ticket App on `E2E_APP_PORT` (default `E2E_PORT + 100`). Ask the lead for that port too, or set it.

## Merge conflicts

- `server/db/schema.ts`: add new tables at the end under `// Issue NN: <topic>`. Do not reorder or reformat existing code. Add a column to an existing table only when needed.
- Keep edits to shared files (`tickets.ts`, `policy.ts`, `mcp.ts`, `navigation.ts`, `[ref].vue`, `new.vue`) small and local.
- Conflicts in text are cheap. The expensive merges are semantic: a type or fact that your branch changes while another branch still assumes the old shape. When you change a shared type (`Principal`, `PolicyTicket`, a payload), search all callers and fix them in your branch.

## Migrations

- Generate with `pnpm exec drizzle-kit generate --name issue_NN_<topic>`. The lead renumbers at merge with `scripts/renumber-migration.sh`. Put seed data in the same file, by hand.
- drizzle-kit rebuilds a table in ways that are wrong on D1. Fix each by hand:
  1. It writes `PRAGMA foreign_keys=OFF`. D1 ignores it. Delete it.
     - If no other table has a foreign key to the rebuilt table (for example `audit_log` in 0013), drizzle's own steps are correct: create `__new_<table>`, copy the rows, drop the old table, rename.
     - If another table has a foreign key to the rebuilt table, write `PRAGMA defer_foreign_keys = on`. Then copy the rows aside, drop, recreate under the original name, and insert the rows back (see 0018). A plain drop and rename would break the references.
  2. The copy step must name only columns of the old table. A column that is new in the rebuilt table is not in the copy.
  3. Write plain column names inside `CHECK`. The `__new_` prefix breaks after the rename.
- `pnpm lint:migrations` fails on:
  - any `PRAGMA foreign_keys`,
  - `__new_` inside a `CHECK`,
  - an `INSERT ... SELECT` that names a column the source table does not have at that point,
  - a mismatch between the SQL files and `migrations/meta/_journal.json`.
- `test/worker/migrations.test.ts` applies the migrations one at a time. After each one it checks that no table lost rows, that `PRAGMA foreign_key_check` is empty, and that `sqlite_sequence` values did not go down.
- Neither check replaces reading the SQL.

## Decisions and docs

- Make technical decisions yourself. Ask the lead only when blocked.
- Do not edit `docs/DECISIONS.md`, `CONTEXT.md`, `docs/PRD.md`, or `docs/issues/README.md`. Record decisions in your issue file under "Decisions made here", and new terms under "Glossary terms to add". The lead copies them to DECISIONS.md and CONTEXT.md.

## Done means

1. Each acceptance criterion has a test (Vitest in `test/worker/`, Playwright in `e2e/`), or a note why not.
2. `pnpm test`, `pnpm typecheck`, and `E2E_PORT=<E2E_PORT> pnpm e2e` pass. Report the counts.
3. You saw new screens in a browser on your dev server, or you say they were not seen.
4. The issue file has each criterion checked with evidence, "Not verified", "Decisions made here", and "Notes for later issues".
5. Everything is committed on your branch. The commit message ends with `Co-Authored-By: <model> <noreply@anthropic.com>`.
6. A `reviewer` agent ran on your branch diff and its findings are fixed or answered.

Final reply to the lead: branch, commit SHAs, test counts, schema changes and migration name, files changed outside your area, what is not done. Keep it short.
