# 42 · Application scopes: own tickets or all tickets, for each permission

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner decisions, 2026-10-18: "an application should have both modes, read all, or read only what it creates", then "all permission should be there but admin can decide what to give (read, write, etc)". Use case: the time tracking Ticket App's timesheet reads live ticket titles and Status from its backend with an API key.

## What to build

Today an Application reaches only the tickets it created for its Contacts (issue 12). Give each permission a scope that the Admin chooses.

| Permission | `own` | `all` |
|---|---|---|
| `tickets:read` | today's rule | every ticket that is not deleted |
| `tickets:update` | today's rule | every ticket it can read |
| `comments:create` | today's rule | every ticket it can read |
| `tickets:create` | always its own | — |

- **Data:** `application.ticket_scopes` (JSON) `{ read, update, comment }`, each `own` or `all`, default all `own`; and `application.include_restricted` (boolean, default false). Plain `ALTER TABLE ADD` columns.
- **Rules (422 otherwise):** a scope of `all` needs its permission. `update: all` or `comment: all` needs `read: all`. `include_restricted` needs at least one `all`.
- **Restricted tickets** (Participants only, 3.32): hidden from every `all` scope unless `include_restricted` is on. An Application is never a Participant.
- **One rule in `policy.ts`:** `readableTickets`, `canRead` and `authorize` get the scopes from the `ApplicationPrincipal` (and the facts from `policyFacts`). No route checks scopes itself. The SQL rule and the single-ticket rule must give the same answer for each scope.
- **Actor on a ticket the Application did not create:** there is no Contact, so the actor is the Application itself: a new actor kind `{ kind: 'application', application: { id, name } }` in comments, Activity, the audit log and the Event payload. In the staff UI it shows as the Application name ("Checkout site changed the Status"). On its own tickets nothing changes (it acts for its Contact).
- **The view does not change.** Every output for an Application keeps the Application view (`forViewer`, `toActor`, `applicationView`): staff are `support`; no assignee, no Team, no Internal Comments, no Ticket App names. An Application's comment is always public.
- **Webhooks follow `read`:** `fanOut` delivers Events of every ticket the Application can read (same Restricted rule). The payload stays the Application view.
- **Search and list:** `GET /api/v1/tickets` and its filters work over the readable set. `requester=me` means "created by this Application".
- **Admin UI** (Application page): the four permissions as rows, each with an on/off switch; read, update and comment also have an Own / All choice. Any `all` shows a warning ("This Application can read every ticket in Tikki, without staff data" / "… change every ticket …"). The Restricted checkbox under them. Changes are admin audit entries (`application_changed`, before and after).
- **Rate limits** stay per Application.
- **OpenAPI and docs:** the Application object gets `ticket_scopes` and `include_restricted`; the API reference and the guides say what each scope reaches and what an Application never sees.

## Acceptance criteria

- [ ] Test: with all scopes `own`, nothing changes (the existing Application tests pass unchanged).
- [ ] Test: `read: all` reads another Application's ticket and a User's ticket by GET, list and search; a deleted ticket stays 404; a Restricted ticket is 404 until `include_restricted` is on.
- [ ] Test: `read: all` with `update: own` and `comment: own`: a PATCH or a comment on a ticket it did not create answers 403; on its own ticket it works.
- [ ] Test: `update: all` and `comment: all` change and comment on a User's ticket; the actor is `{ kind: 'application' }` in the comment, the Activity, the audit entry and the Event; staff see the Application name.
- [ ] Test: the rules give 422: `update: all` without `read: all`; `all` without its permission; `include_restricted` with no `all`.
- [ ] Test: in every scope the Application view holds: no assignee, no Team, no Internal Comments in comments or Activity, staff as `support`.
- [ ] Test: webhooks: a `read: all` Application's endpoint gets Events for other tickets, in the Application view; not for Restricted tickets without the setting; a `read: own` Application's endpoint gets only its own (unchanged).
- [ ] Test: `readableTickets` and `canRead` agree for each scope (the REST tests check both, as for Users).
- [ ] Test: scope changes are Admin only and audited.
- [ ] Playwright: the Admin sets read and comment to All on an Application, sees the warnings, and the settings survive a reload.

## Blocked by

None. Builds on issues 12, 13, 15 and 27.
