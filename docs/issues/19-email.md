# 19 · Notification emails

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Users get the notifications they chose by email. The mail transport and the sending domain already exist from issue 01.

- Notification emails follow each User's preferences from issue 18. Each email has the Ticket Reference, a short summary, and a link to the ticket.
- Settings shows the sender and a "Send test email" action.
- Transport errors (for example the daily limit) are logged and shown to Admins. They never block or roll back the ticket change.
- With the `none` transport, nothing is sent, and the Inbox still gets every notification.

## Acceptance criteria

- [ ] Test with the capturing transport: each preference produces the expected emails and no others.
- [ ] Test: a Requester never gets an email about an Internal Comment.
- [ ] Test: with the `none` transport, notifications still reach the Inbox.
- [ ] Test: a transport error does not roll back the ticket change, and the Admins see it.
- [ ] Manual check on staging: a real notification email arrives.

## Blocked by

- [18 · Inbox notifications and preferences](18-inbox-notifications.md)
