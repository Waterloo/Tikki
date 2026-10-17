# 18 · Inbox notifications and preferences

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Every User sees what needs them in the in-app Inbox, with or without email.

- Fan-out follows the notification table in DECISIONS.md section 8: ticket created (owning Team, Requester confirmation), assigned (assignee), Public Comment (Requester, assignee), Internal Comment (assignee only), Status changed (Requester), webhook endpoint failing or disabled (Admins).
- The Inbox screen (design canvas): grouped by day, All and Unread filters, "Mark all as read", each notice opens its ticket or endpoint, "You are up to date" when empty. The unread count shows in the sidebar.
- The "Email me when" preferences panel is stored per User now. "Assigned to me" is always on. Email sending itself comes in issue 19.

## Acceptance criteria

- [~] REST test for each row of the notification table: the right Users get a notice and nobody else does.
  Evidence: `test/worker/notifications.test.ts`, "notices: fan-out": ticket created, assigned, Public Comment, Internal Comment, Status changed, and webhook failing (through `notifyAdmins`, Admins only). Each test names the exact recipients and checks that the actor and everyone else got none. **Not complete:** the webhook row is only covered by the exported `notifyAdmins`; issue 14 must call it when an endpoint fails or is disabled (8.7). The Requester confirmation and the Source Application column are not written (see Decisions).
- [x] REST test: a Requester never gets a notice about an Internal Comment.
  Evidence: `test/worker/notifications.test.ts`, "Internal Comment: the assignee only. A Requester never gets one". The Requester's list has no such notice, the text does not appear in it, and a refused Internal Comment from a Requester writes none.
- [x] REST test: "Mark all as read" sets the unread count to 0.
  Evidence: `test/worker/notifications.test.ts`, "lists only the own notices, filters Unread, and Mark all as read sets the count to 0" (also checks the count endpoint, marking one notice, and that another User cannot mark it).
- [x] REST test: "Assigned to me" cannot be turned off.
  Evidence: `test/worker/notifications.test.ts`, "\"Assigned to me\" is always on and cannot be turned off" (422 `VALIDATION_FAILED`, nothing in the same request is stored).
- [x] Playwright flow: an Agent assigns a ticket, and the assignee sees the notice and opens the ticket from it.
  Evidence: `e2e/inbox.spec.ts`. The Admin assigns through REST (the ticket page only has "Assign to me" until issue 20 adds a picker). The assignee sees the unread notice and the sidebar count, opens the ticket from the notice, then uses Mark all as read, the Unread filter ("You are up to date"), and checks that "Assigned to me" is on and locked. The test promotes the assignee with `wrangler d1 execute` because role changes come with issue 20.

## Blocked by

- [06 · Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md)

## Not verified

- Light mode and the Inbox at 375 px were only checked for horizontal scroll (none) and dark mode by screenshot; light mode was not looked at.
- The slow poll of the unread count (60 s) was not exercised by a test.
- The "webhook failing or disabled" criterion row is open until issue 14 calls `notifyAdmins`.

## Decisions made here

- Storage: one `notification` row for each recipient (`kind`, `ticket_number`, `comment_id`, `actor_id`, `data` JSON, `read_at`). The Inbox always gets every notice; preferences never filter it (8.15). Text for the ticket kinds is built when read (actor name, ticket reference, Status name or comment excerpt), so a comment excerpt follows Erasure. Webhook kinds store `{ head, body, href }` in `data`, because they have no ticket.
- Writers return statements for the existing `db.batch` of the change (`noticeTicketCreated`, `noticesForChange`, `noticeComment` in `server/utils/notifications.ts`). Recipients are chosen with `INSERT ... SELECT`, so a change costs a constant number of statements. D1 batches do not take `db.run`; the helper uses `db.insert().select(sql)`, where the SELECT lists every column of the table in order.
- No Team membership table exists yet, so "ticket created" goes to every Agent and Admin except the actor. After issue 20: join the membership table on the Team of the ticket's type in `noticeTicketCreated` (one place).
- The Requester confirmation is not written. In v1 the Requester is always the actor, and the actor never gets a notice. It becomes real with issue 12 (an Application creates a ticket for a Contact); add it in `noticeTicketCreated`. The "Source Application" column is also issue 12.
- Revert goes through `applyChange`, so a revert of a Status or assignee change notifies like any other change.
- An Internal Comment notice is hidden at read time from a User who is no longer staff.
- Preferences: table `notification_preference` (row only after a change; defaults in code: all on, except internal notes). The switches shown depend on the role (a Requester sees "replies" and "Status changes" only; "webhook" is for Admins). "Assigned to me" is always on: a PATCH with `assigned: false` answers 422, and the row is never written. A "Status of my ticket changes" switch was added for Requesters, because 8.x lets Users turn off email for each event and the canvas had no switch for this event.
- REST: `GET /api/v1/notifications?filter=unread&cursor&limit` (also returns `unread_count`), `GET .../unread-count`, `POST .../read-all`, `POST .../{id}/read`, `GET|PATCH .../preferences`. Notices are scoped to the signed-in User by the query, so no policy action is involved.
- Sidebar count: one indexed count (`notification_user_read_idx`), fetched on mount, on route change, and every 60 s while the tab is visible.
- Migration: `0006_issue_18_notifications.sql` (tables `notification`, `notification_preference`).

## Glossary terms to add

- **Notice**: one entry in a User's Inbox. Made when a ticket changes or an endpoint fails. Never made for the actor of the change.
- **Inbox**: the in-app list of a User's Notices. It always gets every Notice, with or without email.

## Notes for later issues

- Issue 14: call `notifyAdmins(db, 'webhook_failing' | 'webhook_disabled', { head, body, href })` from `server/utils/notifications.ts` (8.7: disable after 3 days of failure). Then tick the open criterion row.
- Issue 19: send email from the Notices. Read the User's switch with `getPreferences` (key per kind: `ticket_created` -> `team_ticket`, `assigned` -> `assigned`, `public_comment`, `internal_comment`, `status_changed`, `webhook_*` -> `webhook`). `assigned` is always on.
- Issue 20: join Team membership in `noticeTicketCreated`. Add an assignee picker if the Agent should assign others from the UI.
- Issue 12: add the Requester confirmation and the Source Application recipient.
