# Issues

Vertical slices of [the PRD](../PRD.md). Each slice goes through every layer and has its own tests. When the project gets an issue tracker, move these files there and keep the numbers in the titles.

- **AFK** (`ready-for-agent`): an agent can build and merge it without a person.
- **HITL**: a person must do something (account setup, a manual check, a decision).

| # | Issue | Type | Blocked by |
|---|---|---|---|
| 01 | [Walking skeleton: Claude creates a ticket](01-walking-skeleton.md) | HITL | — |
| 02 | [CPU budget check in CI](02-cpu-budget-check.md) | AFK | 01 |
| 03 | [Ticket Types with Fields and the web form](03-ticket-types-with-fields.md) | AFK | 01 |
| 04 | [Claude creates tickets with Fields](04-claude-creates-tickets-with-fields.md) | AFK | 03 |
| 05 | [Roles, policy, and the agent queue](05-roles-and-agent-queue.md) | AFK | 03 |
| 06 | [Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md) | AFK | 05 |
| 07 | [Admin creates and edits Ticket Types and Fields](07-admin-ticket-types-and-fields.md) | AFK | 05 |
| 08 | [Change Ticket Type, change prefix, and reference lookup](08-change-type-and-references.md) | AFK | 07 |
| 09 | [Requester self-service: edit, cancel, reopen](09-requester-self-service.md) | AFK | 06 |
| 10 | [Search, filters, and similar tickets](10-search-and-filters.md) | AFK | 05 |
| 11 | [Claude: follow-up for Requesters and tools for Agents](11-claude-follow-up-and-agent-tools.md) | AFK | 06 |
| 12 | [Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md) | AFK | 05 |
| 13 | [Application actions for Contacts](13-application-actions-for-contacts.md) | AFK | 09, 12 |
| 14 | [Outbox and admin Webhook Endpoints](14-outbox-and-admin-webhooks.md) | AFK | 06 |
| 15 | [Application Webhook Endpoint](15-application-webhook.md) | AFK | 12, 14 |
| 16 | [Attachments](16-attachments.md) | AFK | 05 |
| 17 | [AI attachments: inline text and Upload Links](17-ai-attachments.md) | AFK | 11, 16 |
| 18 | [Inbox notifications and preferences](18-inbox-notifications.md) | AFK | 06 |
| 19 | [Email: transport, email OTP sign-in, notification emails](19-email.md) | HITL | 18 |
| 20 | [People: invites, roles, deactivation, Teams](20-people-and-teams.md) | AFK | 05 |
| 21 | [Settings, branding, and the first-run screen](21-settings-and-first-run.md) | AFK | 03 |
| 22 | [Soft delete and Erasure](22-soft-delete-and-erasure.md) | AFK | 12, 14 |
| 23 | [Rate limits](23-rate-limits.md) | AFK | 12 |
| 24 | [Production baseline and self-hosting](24-production-baseline.md) | HITL | 01 |

**Can run in parallel:** after 01: 02, 03, 24. After 03: 04, 05, 21. After 05: 06, 07, 10, 12, 16, 20.
