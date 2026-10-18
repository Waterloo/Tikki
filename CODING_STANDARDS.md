# Coding standards

Read this when you review a diff. Check every rule against every changed hunk. Module map and reasons: [docs/architecture.md](docs/architecture.md).

## Server

1. **One read rule.** Single-ticket reads go through `authorize` / `loadFor`. Lists go through `readableTickets`. No new `if (role === ...)` or visibility check outside `server/utils/policy.ts`. A second rule leaks Restricted, deleted, or Contact tickets. See "Read rule".
2. **Every ticket write goes through `applyChange`** (or `withEvent` + `auditEntry` + a notice writer in one `db.batch` for create and comment). A direct `db.update(ticket)` skips the audit entry, the Event, and the notices. See "Ticket writes".
3. **Narrow `principal.kind` before `principal.userId`.** `Principal` is `UserPrincipal | ApplicationPrincipal`. A ticket of an Application has a Contact Requester, so `requesterId` is null. Check each new `userId` read and each `requesterId` use for the Application branch.
4. **Anything that reaches an Application uses its view function.** REST ticket, Activity, comment, webhook payload: staff show as `support`, with no name, email, assignee, Team, or Internal Comment. A new output or payload field needs the view change in the same diff. See "Views for an Application".
5. **`PolicyTicket` comes only from `policyFacts`.** A new fact must reach `policyFacts` and its `Pick<DetailRow, ...>`. A fact that is missing or hard-coded changes the read rule without a type error.
6. **Audit values live only in `before` and `after`.** Facts go in their own columns. Erasure clears exactly those two columns. See "Audit log".
7. **A new table or column with personal data is covered by Erasure.** Add it to `eraseContact` in `server/utils/privacy.ts`. The scan test in `test/worker/privacy.test.ts` must stay as strict as before.
8. **Mail and other slow side effects run after the batch, in `waitUntil`** (`queueNoticeMail`). They never sit inside the change path.
9. **Text from users reaches the AI only through `untrusted()` / `untrustedDeep()`.** See "Text for the AI".
10. **`server/entry.ts` keeps the Nitro `scheduled` handler.** A Cron step goes in `server/plugins/outbox.ts`.

## Database

11. **Migrations are reviewed by hand.** Read each generated SQL file. A table rebuild must follow `docs/agents/parallel-work.md`: it differs when another table has a foreign key to the rebuilt table. `pnpm lint:migrations` and `test/worker/migrations.test.ts` must pass. They do not replace reading the SQL.
12. **D1 has no interactive transactions.** Statements that must succeed together share one `db.batch`. A `await` between two writes of one change is a finding.

## Tests

13. **A changed rule has a test that fails without the change.** Permission and view rules need a test per Principal kind: User and Application.
14. **E2E toast checks use `expectToast`** (`e2e/toast.ts`). A Nuxt UI toast also writes its text into a hidden live region, so a plain text locator is flaky.
15. **E2E Admin sign-in uses `signInAsAdmin`** (`e2e/sign-in.ts`). Sign-in codes are limited to 5 an hour for one address. Only `e2e/auth.setup.ts` and `e2e/sign-in.spec.ts` sign the Admin in through the UI.

## UI

16. **Check the change at 375 px and desktop width, in light and dark mode.** No horizontal page scroll at 375 px. A diff with UI changes and no such check is a finding.
