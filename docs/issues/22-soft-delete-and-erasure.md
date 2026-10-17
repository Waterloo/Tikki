# 22 · Soft delete and Erasure

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Admins clean up mistakes reversibly, and personal data can be erased when the law requires it.

- Soft delete: an Admin hides a ticket everywhere (lists, search, MCP, REST, webhooks) and can restore it.
- Erasure, from Settings › Privacy (search by email or external ID) or `DELETE /api/v1/contacts/{id}` by the owning Application:
  - The Contact's name and email become `[erased]`.
  - The free text, Field values, and Attachments of the Contact's tickets are removed. The tickets stay.
  - Their audit entries lose their values but keep who, what, and when.
  - Outbox rows and deliveries that contain the Contact's data are purged.
- Delivered outbox payloads are purged after 30 days by the scheduled handler.

## Acceptance criteria

- [ ] REST test: a soft-deleted ticket is invisible to every channel and visible again after restore.
- [ ] REST test: after Erasure, no API response, stored audit value, outbox row, or R2 object contains the Contact's name, email, or ticket text.
- [ ] REST test: the tickets still exist with their numbers, Statuses, and audit facts.
- [ ] REST test: an Application can erase only its own Contacts.
- [ ] Scheduled-handler test with a test clock: payloads older than 30 days are purged.

## Blocked by

- [12 · Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md)
- [14 · Outbox and admin Webhook Endpoints](14-outbox-and-admin-webhooks.md)
