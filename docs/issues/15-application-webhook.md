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

- [ ] Delivery test: Application A's endpoint never receives an Event about Application B's ticket or an internal ticket.
- [ ] Delivery test: an Internal Comment on A's ticket sends nothing to A. A Public Comment sends `comment.created`.
- [ ] REST test: an attempt to set other events or "include internal data" on an Application endpoint is refused.
- [ ] Payloads contain `number` and `ref`.

## Blocked by

- [12 · Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md)
- [14 · Outbox and admin Webhook Endpoints](14-outbox-and-admin-webhooks.md)
