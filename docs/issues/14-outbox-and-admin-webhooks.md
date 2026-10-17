# 14 · Outbox and admin Webhook Endpoints

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Every ticket change reaches team tools such as Slack or n8n reliably.

- Each change writes its Event to the outbox in the same D1 `batch()` as the change and its audit entry.
- Events: `ticket.created`, `ticket.updated` (with `changed` Field Keys), `comment.created`. Payload: `event_id`, `type`, `changed`, `actor`, and the full ticket `before` and `after`, each with `number` and `ref`.
- A scheduled handler delivers Events at least once, signed with HMAC-SHA256. Retries use backoff for up to 24 hours. After 3 days of continuous failure, the endpoint is disabled and the Admins are notified.
- Admin "Webhooks" screen (design canvas): add and edit endpoints, choose events, "include internal data" (off by default), rotate the signing secret, "Send test event", "Retry now", status, and a delivery log with the payload.

## Acceptance criteria

- [ ] REST test: a ticket change and its outbox Event are both stored, or neither is.
- [ ] Delivery test: the receiver gets a correct signature, `before`, `after`, and `changed`.
- [ ] Delivery test: an endpoint without "include internal data" never gets Internal Comments or internal Field data.
- [ ] Delivery test with a test clock: failures retry with backoff, stop after 24 hours, and disable the endpoint after 3 days.
- [ ] Delivery test: a repeated delivery has the same `event_id`.
- [ ] Rotating the secret changes the signature of the next delivery.

## Blocked by

- [06 · Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md)
