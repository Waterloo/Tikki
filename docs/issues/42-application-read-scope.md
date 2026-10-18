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

Checked on 2026-10-18. `pnpm test` (539 tests, 48 files), `pnpm typecheck`, and `E2E_PORT=9844 pnpm e2e` (119 tests; two full runs before and two after the reviewer fixes, all green) pass. REST tests: `test/worker/application-scopes.test.ts`; webhook tests: `test/worker/application-webhook.test.ts` ("read scope all").

- [x] Test: with all scopes `own`, nothing changes.
  Evidence: the Application tests of issues 12, 13 and 15 pass, and "own: reads only its own tickets, by GET, list and search". Two old tests changed on purpose: "refuses Agent changes and the assignee and Team filters" (`requester=me` is now the Application's own tickets, as the spec asks; `team` is now 422, see Decisions), and the policy unit test builds the Principal with `scopes`.
- [x] Test: `read: all` reads another Application's ticket and a User's ticket by GET, list and search; a deleted ticket stays 404; a Restricted ticket is 404 until `include_restricted` is on.
  Evidence: "all: reads another Application's ticket and a User's ticket; a deleted ticket stays hidden", "all: a Restricted ticket stays hidden until "Include Restricted tickets" is on" (also: an `own` Application with the flag set in the row still gets 404), "fails closed: a stored `all` without tickets:read reads nothing of others".
- [x] Test: `read: all` with `update: own` and `comment: own`: a PATCH or a comment on a ticket it did not create answers 403; on its own ticket it works.
  Evidence: "read: all with update and comment own: refuses writes on a ticket it did not create, allows them on its own". PATCH, comment, cancel and a file upload on a User's ticket answer 403, `allowed_actions` is empty; on its own ticket a comment answers 201 and cancel 200 (the actions of `update: own`), and a Status PATCH stays 403 as before.
- [x] Test: `update: all` and `comment: all` change and comment on a User's ticket; the actor is `{ kind: 'application' }` in the comment, the Activity, the audit entry and the Event; staff see the Application name.
  Evidence: "reverts a Status change with update: all, and refuses it with update: own", "refuses reopen of a ticket it did not create, also with update: all", "adds a file to a User's ticket with update: all", "update and comment all: changes and comments on a User's ticket, as the Application itself" (comment answer, Agent Activity and comments, `audit_log.application_id`, the Requester's notices "Timesheet changed BUG-1 to In progress"); "update all on its own ticket still acts for its Contact"; webhook test "gets Events of other tickets in the Application view" (`comment.author.kind: application`, `actor.kind: application` in the Admin and the Application endpoint).
- [x] Test: the rules give 422.
  Evidence: "refuses scopes that break the rules (422)": update or comment `all` without read `all`, `all` without its permission, `include_restricted` with no `all`, a bad value, and a permission removed while its scope is `all`.
- [x] Test: in every scope the Application view holds.
  Evidence: "lists the files of a readable ticket by the read rule, without the uploader's User ID", "hides the value of a `user` Field in the ticket and in Activity", webhook "removes `user` Field values from the payload", "keeps the Application view in all scope": `assignee: null`, `assigned: true`, no `team`, Requester `support` in GET and list; only the Public Comment in comments; no Internal Comment and only `support` actors in Activity; no staff or Requester email or ID in any body. The `own` view tests of issues 13 and 15 still pass.
- [x] Test: webhooks.
  Evidence: "gets Events of other tickets in the Application view; an own Application does not", "gets no Event of a Restricted ticket until "Include Restricted tickets" is on", "fails closed: no Events of other tickets for a stored `all` without tickets:read, or a Restricted ticket for an own Application with the flag", "shows another Application's comment on its own ticket as that Application, not as its Contact". The issue 15 test "never gets an Event about another Application's ticket or an internal ticket" still passes.
- [x] Test: `readableTickets` and `canRead` agree for each scope.
  Evidence: every read check in `application-scopes.test.ts` goes through `reads()`, which asks GET (`canRead`), the list and search (`readableTickets`) and fails when they disagree.
- [x] Test: scope changes are Admin only and audited.
  Evidence: "is for Admins only, and writes an audit entry with the old and new values" (Agent and API key 403, no entry; one `application_changed` entry, none for a repeat with the same values).
- [x] Playwright: the Admin sets read and comment to All, sees the warnings, and the settings survive a reload.
  Evidence: `e2e/applications.spec.ts` "an Admin sets read and comment to All tickets, sees the warnings, and the settings stay after a reload" (also: Restricted checkbox, read back to Own resets comment and Restricted).

## Not verified

- Seen on the dev server (port 8844) in the browser pane: the Application page at desktop width and at 375 px, each in light and dark (no horizontal scroll; the Own / All choice wraps under the label); the ticket page with "Timesheet (via API) changed Status" and the comment with the Application name and the "Application" chip; the Inbox notices. Not seen: the error toast of a refused save (the page applies the rules first, so a click does not get 422).
- The OpenAPI document describes the scopes in its introduction and on the list and get operations. It has no Application object (the Admin routes were never in it) and no PATCH, comment or attachment operations; adding those is outside this issue.
- With `read: all` an Application gets the name and email of other Applications' Contacts (REST, Activity, webhooks). That is inside the spec ("without staff data"), but those copies leave Tikki, and Erasure (9.2) cannot reach them. The owner may want to know before an Admin turns `all` on for a third-party system.
- CPU per route was not measured on Cloudflare. The read rule adds no join; `fanOut` adds two indexed lookups on `application` per Application endpoint.

## Decisions made here

- **Scopes on the row and the Principal.** `application.ticket_scopes` (JSON `{ read, update, comment }`) and `application.include_restricted`. `ApplicationPrincipal` carries `scopes` and `includeRestricted`, read with the key in the same query.
- **One rule, fail closed.** `scopeOf` in `policy.ts`: a scope is `all` only when its permission is there too. `applicationReads` is the one-ticket rule, `readableTickets` its SQL form, and `fanOut` has the same rule in SQL (`readAll`, `includeRestricted`). A Restricted ticket needs `read: all` and `include_restricted`; an `own` Application never reads one, as before.
- **What `update: all` allows.** On every ticket it reads: change Status, change Priority, edit Fields, and add files. Not assign, Team, Ticket Type, description, Participants or delete: those are staff actions or staff data. Cancel and reopen stay for its own tickets only, because they are Requester actions. `update: own` is unchanged (cancel and reopen).
- **Files.** Adding a file to a ticket it did not create needs `update: all` (`authorizeAttach`). The file list follows the read rule (`authorizeListAttachments`; before, it used the upload rule, which was the same only while an Application read its own tickets). An Application gets `uploader_id: null` (`toView`).
- **`user` Fields.** A Field of type User holds a User ID, so an Application never gets the value: it is left out of `fields` (`toDetail`, `applicationView`), Activity shows "Support", and type-change leftovers (`unmoved`) are empty for an Application. The `field=` filter is not changed: it can only confirm a guessed random User ID.
- **Revert.** An Application with `update: all` can revert a Status, Priority or Field change (the same actions); `update: own` gets 403 as before.
- **The actor.** On its own ticket the Application acts for its Contact (unchanged). On another ticket the REST views (`toActor`) show `{ kind: 'application', application: { id, name } }`. The staff UI shows the Application name and the "Application" source chip; Activity reads "Timesheet (via API) changed …". The Event payload keeps its existing actor shape `{ kind: 'application', id, name, channel }` for every Application action, so Admin endpoints see no change; in an Application endpoint, a comment author on a ticket that is not the author's own is `{ kind: 'application', application: { id, name } }`.
- **Every User is `support` to an Application**, also as Requester: `RequesterView` gets `{ kind: 'support' }` (`forViewer`, `applicationView`). With `read: all` an Application reads Users' tickets, and a Requester can be an Agent. Activity already showed every User as `support`.
- **Filters.** For an Application `requester=me` is "created by this Application". `team` now answers 422 for an Application, as `assignee` did: Team is staff data that the view hides, so a filter must not reveal it.
- **Notices name the acting Application.** `notification.application_id` (new, nullable). Before, a notice without a User actor named the Contact's Application, which is wrong when the Application acts on a User's ticket or another Application's ticket. Old rows fall back to the Contact's Application.
- **Admin audit.** Every Application change through `PATCH /api/v1/applications/{id}` now writes one `application_changed` entry (subject type `application`) with the old and new values of the changed keys. Before, no Application change was audited.
- **Admin UI.** Four rows with a switch; read, update and comment have Own tickets / All tickets. The page applies the rules before it saves (update or comment on All also sets read to All and turns on `tickets:read`; read to Own sets the others to Own; switching off a permission sets its scope to Own; Restricted turns off without an `all`), so a click never answers 422.
- **Migration** `0029_issue_42_application_scopes.sql`: three plain `ALTER TABLE ADD`.

## Glossary terms to add

- **Ticket scope**: For an Application permission (read, update, comment): `own`, only the tickets the Application created, or `all`, every ticket that is not deleted. Restricted tickets need "Include Restricted tickets" too.

## Notes for later issues

- `RequesterView` now has `{ kind: 'support' }`. Only an Application gets it; Ticket App context tokens are for Users, so `AppContext.requester` never has it at runtime, but the type allows it.
- A new action for Applications goes into `APPLICATION_UPDATES` in `policy.ts` only if it is not staff data.
- `noticeTicketCreated`, `noticesForChange` and `noticeComment` now take the Principal, not an actor ID.

## Blocked by

None. Builds on issues 12, 13, 15 and 27.
