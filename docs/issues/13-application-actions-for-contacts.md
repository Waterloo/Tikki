# 13 · Application actions for Contacts

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

An Application acts for its Contacts with the same rules as an internal Requester.

- Add a Public Comment for the Contact (with `comments:create`).
- Cancel and reopen the Contact's ticket (with `tickets:update`), with the same limits as issue 09.
- The ticket screen shows these comments as "Contact · <Application>".

## Acceptance criteria

- [x] REST test: an Application comment is Public, and its author is the Contact through the Application. (`test/worker/applications.test.ts`: "shows an Application comment as Public...")
- [x] REST test: cancel and reopen follow the issue 09 rules for Application tickets. (cancel; refused when done; reopen refused unless resolved; same ticket at 13 days; linked new ticket at 15 days)
- [x] REST test: an Application without the needed permission is refused. (cancel and reopen without `tickets:update`: 403; comments without `comments:create`: already tested in issue 12)
- [x] REST test: an Application cannot act on another Application's ticket. (cancel, reopen, comment: 404 NOT_FOUND; ticket unchanged)

Also: e2e `e2e/contact-actions.spec.ts` (the Admin sees "Contact · <Application>" on a comment and the cancel in Activity). `pnpm test`: 331 passed (26 files). `pnpm typecheck`: clean.

## Not verified

- The new chip was checked by Playwright text assertions only, not by eye in light and dark mode or at 375 px. It reuses existing tokens and sits in the existing flex-wrap header.
- Webhook payloads (issue 15) still carry the assignee name and email and the old `application` author shape; see the notes below.

## Decisions made here

- **No schema change.** An Application acts only on its own Contact's ticket (`canRead`), so the Contact is always `ticket.contact_id`. `comment.application_id` and `audit_log.application_id` stay; the view builds the Contact from the ticket.
- **Actor view.** `ActorView` is now `user | contact | support`. An action of an Application shows as `{ kind: 'contact', contact: { id, external_id, name, email }, application: { id, name } }` in comments and Activity, on every channel (REST, MCP text). The old `kind: 'application'` is gone from these views. The UI shows the Contact's name with the chip "Contact · <Application>"; Activity lines read "Ana Lima (Contact · Acme Shop) (via API) cancelled this ticket".
- **Cancel and reopen for an Application** are in `authorize`: `tickets:read` first, then `tickets:update`, then the same rules as a Requester (no cancel when done; reopen only when `resolved`). The Application counts as the Requester of its own tickets. `cancelTicket` and `reopenTicket` are reused unchanged. A reopen after 14 days copies `contact_id`, so the new ticket is the same Contact's. A new Application ticket now lists `allowed_actions` `['comment', 'cancel']` with `tickets:update`.
- **Staff privacy for Applications.** `assignee` is always `null` for an Application and the new field `assigned: boolean` says whether someone is assigned (`TicketSummary`, all channels; Users still get `assignee` plus `assigned`). In Activity and comments, a User actor shows as `{ kind: 'support' }` (no name, no email), and an assignee change shows the value "Support". Team name stays visible (it is the Ticket Type's Team, not a person).

## Glossary terms to add

- **Support**: How an Application sees any Agent or Admin: no name, no email.

## Notes for later issues

- Issue 15 (Application webhooks): the outbox JSON (`server/utils/outbox.ts`: ticket `assignee`, actor, comment `author`) still gives staff name and email and `kind: 'application'`. Apply the same rules before sending to an Application's endpoint: no assignee person (only `assigned`), staff as `support`, an Application's own actions as the Contact through the Application.
- Issue 22 (Erasure): an Application's comments now show the Contact's name and email through the ticket's Contact, so clearing the Contact row clears them from the views.


- [09 · Requester self-service](09-requester-self-service.md)
- [12 · Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md)
