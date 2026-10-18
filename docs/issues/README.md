# Issues

Vertical slices of [the PRD](../PRD.md). Each slice goes through every layer and has its own tests. When the project gets an issue tracker, move these files there and keep the numbers in the titles.

- **AFK** (`ready-for-agent`): an agent can build and merge it without a person.
- **HITL**: a person must do something (account setup, a manual check, a decision).

| # | Issue | Type | Blocked by | Status |
|---|---|---|---|---|
| 01 | [Walking skeleton: Claude creates a ticket](01-walking-skeleton.md) | HITL | — | Done, manual checks open (staging email, claude.ai, deploy on merge) |
| 02 | [CPU budget check in CI](02-cpu-budget-check.md) | AFK | 01 | Deferred |
| 03 | [Ticket Types with Fields and the web form](03-ticket-types-with-fields.md) | AFK | 01 | Done |
| 04 | [Claude creates tickets with Fields](04-claude-creates-tickets-with-fields.md) | AFK | 03 | Done, manual checks open (claude.ai) |
| 05 | [Roles, policy, and the agent queue](05-roles-and-agent-queue.md) | AFK | 03 | Done, manual checks open (Playwright flow, done by hand) |
| 06 | [Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md) | AFK | 05 | Done |
| 07 | [Admin creates and edits Ticket Types and Fields](07-admin-ticket-types-and-fields.md) | AFK | 05 | Done |
| 08 | [Change Ticket Type, change prefix, and reference lookup](08-change-type-and-references.md) | AFK | 07 | Done |
| 09 | [Requester self-service: edit, cancel, reopen](09-requester-self-service.md) | AFK | 06 | Done |
| 10 | [Search, filters, and similar tickets](10-search-and-filters.md) | AFK | 05 | Done |
| 11 | [Claude: follow-up for Requesters and tools for Agents](11-claude-follow-up-and-agent-tools.md) | AFK | 06 | Done, manual checks open (claude.ai) |
| 12 | [Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md) | AFK | 05 | Done |
| 13 | [Application actions for Contacts](13-application-actions-for-contacts.md) | AFK | 09, 12 | Done |
| 14 | [Outbox and admin Webhook Endpoints](14-outbox-and-admin-webhooks.md) | AFK | 06 | Done |
| 15 | [Application Webhook Endpoint](15-application-webhook.md) | AFK | 12, 14 | Done |
| 16 | [Attachments](16-attachments.md) | AFK | 05 | Done, manual checks open (CPU budget, needs issue 02) |
| 17 | [AI attachments: inline text and Upload Links](17-ai-attachments.md) | AFK | 11, 16 | Done |
| 18 | [Inbox notifications and preferences](18-inbox-notifications.md) | AFK | 06 | Done |
| 19 | [Notification emails](19-email.md) | AFK | 18 | Done, manual checks open (real email on staging) |
| 20 | [People: invites, roles, deactivation, Teams](20-people-and-teams.md) | AFK | 05 | Done |
| 21 | [Settings, branding, and the first-run screen](21-settings-and-first-run.md) | AFK | 03 | Done, manual checks open (Playwright flow, done by hand) |
| 22 | [Soft delete and Erasure](22-soft-delete-and-erasure.md) | AFK | 12, 14 | Done |
| 23 | [Rate limits](23-rate-limits.md) | AFK | 12 | Done |
| 24 | [Production baseline and self-hosting](24-production-baseline.md) | HITL | 01 | Deferred |
| 25 | [SSO sign-in: Google, Microsoft, generic OIDC](25-sso-sign-in.md) | HITL | 01 | Deferred |
| 26 | [UI foundation: theme, app shell, shared parts](26-ui-foundation.md) | AFK | 01 | Done |
| 27 | [Restricted tickets: Participants only](27-restricted-tickets.md) | AFK | — | Done |
| 28 | [Invite with a role and Teams](28-invite-with-role-and-teams.md) | AFK | — | Done |
| 29 | [Assign to any Agent, and move a ticket to another Team](29-assign-anyone-and-move-team.md) | AFK | — | Done |
| 30 | [Claude checks for duplicates, and the Cron removes old uploads](30-duplicate-check-and-upload-cleanup.md) | AFK | — | Done |
| 31 | [Calmer ticket page actions](31-ticket-page-actions.md) | AFK | — | Done |
| 32 | [No framing of Tikki by other sites](32-frame-protection.md) | AFK | — | Done |
| 33 | [Ticket page tabs: Conversation and Activity](33-ticket-page-tabs.md) | AFK | — | Done |
| 34 | [Ticket Apps: an external page inside the ticket](34-ticket-apps.md) | AFK | 32, 33 | Done |
| 35 | [Ticket Apps change the ticket through the API](35-ticket-app-writes.md) | AFK | 34 | Done |
| 36 | [WebMCP tools in the Tikki page](36-webmcp-tools.md) | AFK | 35 | Done |
| 37 | [One Ticket App, one URL for each placement](37-ticket-app-placements.md) | AFK | — | Done |
| 38 | [Ticket App icons, light and dark](38-ticket-app-icons.md) | AFK | 37 | Done |
| 39 | [App pages: an Apps menu in the main sidebar](39-app-pages.md) | AFK | 37 | Done |
| 40 | [Add a Ticket App from its manifest](40-ticket-app-manifest.md) | AFK | 38, 39 | Done |
| 42 | [Application scopes: own or all tickets, for each permission](42-application-read-scope.md) | AFK | — | Done |
| 43 | [Settings area: set-up screens leave the main sidebar](43-settings-area.md) | AFK | 39 | Done |

All AFK issues except 02 are merged into `integration` on 2026-10-18. The cloud setup is deferred (issues 02, 24 and 25, and the staging checks).

Email OTP is the first sign-in method (issue 01). Issue 25 must be done before a public release, because the `free` profile has no email.

**Can run in parallel:** after 01: 02, 03, 24, 25. After 03: 04, 05, 21. After 05: 06, 07, 10, 12, 16, 20. Then 32 and 33 in parallel, then 34, then 35. 36 can run next to 34 (coordinate the `allow="tools"` test). Then 37; then 38 and 39 in parallel; then 40.
