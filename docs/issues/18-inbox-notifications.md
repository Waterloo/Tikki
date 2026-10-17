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

- [ ] REST test for each row of the notification table: the right Users get a notice and nobody else does.
- [ ] REST test: a Requester never gets a notice about an Internal Comment.
- [ ] REST test: "Mark all as read" sets the unread count to 0.
- [ ] REST test: "Assigned to me" cannot be turned off.
- [ ] Playwright flow: an Agent assigns a ticket, and the assignee sees the notice and opens the ticket from it.

## Blocked by

- [06 · Public and Internal Comments, Activity, and Revert](06-comments-and-activity.md)
