# 42 · Application read scope: own tickets or all tickets

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner decision, 2026-10-18: "an application should have both modes, read all, or read only what it creates". Use case: the time tracking Ticket App's timesheet reads live ticket titles and Status from its backend with an API key.

## What to build

Today an Application reads only the tickets it created for its Contacts (issue 12). Add a second mode.

- New Application setting **"Tickets it can read"**: `own` (default, today's rule) or `all`.
- New setting **"Include Restricted tickets"**: off by default; only with `all`. An Application is never a Participant, so without it Restricted (Participants only, 3.32) tickets stay hidden.
- **Reads follow the mode.** `readableTickets` and `canRead` in `policy.ts` get the mode for an `ApplicationPrincipal` (through `PolicyTicket` facts and the principal; no second rule). In `all` mode the Application reads every ticket that is not deleted, plus Restricted ones only with the setting. `tickets:read` permission is still required.
- **Writes do not change.** Comments, changes, cancel and attachments stay limited to the Application's own tickets in both modes. A write on another ticket answers 403 when the ticket is readable, 404 when not.
- **The view does not change.** Every output for an Application keeps the Application view (`forViewer`, `toActor`, `applicationView`): staff are `support`; no assignee, no Team, no Internal Comments, no ticket App names.
- **Webhooks follow the mode.** `fanOut` delivers Events of every ticket the Application can read in `all` mode (same Restricted rule). The payload stays the Application view.
- **Search and list:** `GET /api/v1/tickets` and its filters work over the readable set. The `requester=me` filter means "created by this Application" for an Application.
- **Admin UI:** on the Application page, a "Tickets it can read" radio (Own tickets / All tickets) with a warning for All ("This Application can read every ticket in Tikki, without staff data"), and the Restricted checkbox under it. Both are admin audit entries (`application_changed`, before and after).
- **Rate limits** stay per Application.
- **OpenAPI and docs:** the Application object gets `read_scope` (`own` | `all`) and `include_restricted`; the developer docs (docs/ticket-apps.md for Ticket App backends, and the API reference) say what each mode reads and what it never sees.

## Acceptance criteria

- [ ] Test: an `own` Application reads only its own tickets (unchanged; the existing tests pass).
- [ ] Test: an `all` Application reads another Application's ticket and a User's ticket in `GET /tickets/{ref}`, the list and search; a deleted ticket stays 404; a Restricted ticket is 404 until "Include Restricted tickets" is on.
- [ ] Test: in `all` mode the Application view holds: no assignee, no Team, no Internal Comments in comments or Activity, staff as `support`.
- [ ] Test: in `all` mode a comment or a PATCH on a ticket the Application did not create answers 403; on its own ticket it works.
- [ ] Test: webhooks: an `all` Application's endpoint gets Events for other tickets, in the Application view; not for Restricted tickets without the setting; an `own` Application's endpoint gets only its own (unchanged).
- [ ] Test: changing the mode is Admin only and audited; turning `include_restricted` on with `own` is 422.
- [ ] Test: `readableTickets` and `canRead` agree for each mode (the REST tests check both, as for Users).
- [ ] Playwright: the Admin sets "All tickets" on an Application and sees the warning; the setting survives a reload.

## Blocked by

None. Builds on issues 12, 13, 15 and 27.
