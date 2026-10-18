# 15 · Application Webhook Endpoint

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

An Application gets updates about its own tickets, so it can inform its customer.

- Each Application has at most one Webhook Endpoint, set on its Application page.
- Its events are fixed (`ticket.created`, `ticket.updated`, `comment.created`) and limited to the Application's own tickets and Public Comments. The Admin cannot widen this.
- Signing secret with rotation, "Send test event", and recent deliveries on the Application page.

## Acceptance criteria

- [x] Delivery test: Application A's endpoint never receives an Event about Application B's ticket or an internal ticket.
  Evidence: `test/worker/application-webhook.test.ts`, "never gets an Event about another Application's ticket or an internal ticket" (A gets only its own `ticket.created`; B only its own; no body holds the internal ticket's number). "ignores stored events and include_internal..." sets `include_internal = 1` and `webhook.test` in the row by SQL and still sees no internal Event.
- [x] Delivery test: an Internal Comment on A's ticket sends nothing to A. A Public Comment sends `comment.created`.
  Evidence: "sends a Public Comment as comment.created and nothing for an Internal Comment" (types are `ticket.created`, `comment.created`; the internal text is in no body).
- [x] REST test: an attempt to set other events or "include internal data" on an Application endpoint is refused.
  Evidence: "refuses other events and \"include internal data\" (422), and a second endpoint (409)": POST and PATCH with other `events`, `include_internal: true` or `name` answer 422; repeating the fixed values is accepted.
- [x] Payloads contain `number` and `ref`.
  Evidence: the first delivery test checks `after.number` and `after.ref`; signature checked with a verifier written in the test.

Also tested: staff email is removed from Application payloads while the Admin endpoint keeps it; Admin-only routes (403 Agent and API key, 401); Admin Webhooks routes answer 404 for an Application endpoint; rotate, test event, retry, delivery list and payload; the CHECK and the unique index in the database; delete.

Playwright: `e2e/application-webhook.spec.ts`: the Admin adds the webhook on the Application page, sees the secret once, a test event to a refusing path shows "Test event failed", Failing, Retry now and the delivery row; rotate shows a new secret. `e2e/applications.spec.ts` got `exact: true` on the name heading, because "Webhook to <name>" also matches.

Migration `0017_issue_15_application_webhook.sql` was run by hand with sqlite3 (foreign keys on, in one transaction) on a database that had an endpoint with a delivery: no foreign key violation, rows kept. It also applies on the fresh DB of the e2e run.

## Not verified

- The new section was not looked at by me in a browser at 375 px or in dark mode; only the Playwright flow ran. Layout copies the canvas and the Admin Webhooks page classes.
- The signing-secret tail (`whsec_••••3k9Q` on the canvas) is not shown: the secret is stored encrypted and only shown once, so the page shows `whsec_••••••••`.
- Delivery on a deployed Worker (as in issue 14).

## Decisions made here

1. **Routes** (Admin only, by Application): `GET|POST|PATCH|DELETE /api/v1/applications/{id}/webhook`, `POST .../rotate-secret`, `.../test`, `.../retry`, `GET .../deliveries`, `GET .../deliveries/{deliveryId}`. `GET` answers `{ data: null }` when there is none. They call issue 14's functions with a `Scope` (the Application ID) instead of copies; `getEndpoint` and friends filter by owner (`admin` when no scope) so the two route sets never see each other's endpoints.
2. **Fixed by the API**: POST takes `url`; PATCH takes `url` and `enabled`. `events` is accepted only if it equals the three fixed events, `include_internal` only if `false`; anything else, and `name`, is 422. The endpoint name is "<Application> webhook".
3. **The filter is in `fanOut` (SQL)**: for `owner = 'application'` it needs `internal = 0`, a type of the three, the type in `events`, and the ticket's Contact's `application_id` = the endpoint's. It ignores `include_internal`. Stored values cannot widen it.
4. **The Application's view of a payload** is one function, `applicationView` in `server/utils/outbox.ts`. It removes `before.assignee.email` and `after.assignee.email` (staff email). Names stay. **Merge with issue 13:** if 13 decides an Application sees less of the assignee or Agent names, change only `applicationView`. It is stored per delivery in the new nullable `webhook_delivery.payload`; null means "send the Event's payload". The sender and the delivery log read `coalesce(delivery.payload, event.payload)`, so the signed bytes are the stored bytes on every retry.
5. **Schema**: `webhook_endpoint.owner` allows `application`; `application_id` (FK); unique index on `application_id` (SQLite allows many NULLs); CHECK `(owner = 'application') = (application_id IS NOT NULL)`. The migration rebuilds the table by copying rows aside (the pattern of 0014), because `webhook_delivery` points to it.
6. Disabling an Application does not stop its webhook; its tickets still change and the Application should hear it.

Copied to DECISIONS.md (rows 8.24, 2.10; changed row 8.6).

## Glossary terms to add

- **Application Webhook Endpoint**: the one Webhook Endpoint of an Application. It sends only `ticket.created`, `ticket.updated` and `comment.created` for the Application's own tickets, without Internal Comments and without staff emails. The Admin cannot widen this.

Copied to CONTEXT.md.

## Notes for later issues

- **Issue 13:** change `applicationView` in `server/utils/outbox.ts` for what an Application sees of the assignee and Agent names (see decision 4). Add the same rule to the REST view if it differs.
- **Issue 22 (Erasure):** an Application delivery can hold its own copy of the payload in `webhook_delivery.payload`. Erase or blank it with `outbox_event.payload` for the Contact's tickets.
- **Insert-select into `webhook_delivery`** (`fanOut`) now has 11 columns; a new column must be added there.

## Blocked by

- [12 · Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md)
- [14 · Outbox and admin Webhook Endpoints](14-outbox-and-admin-webhooks.md)
