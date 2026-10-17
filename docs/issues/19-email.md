# 19 · Email: transport, email OTP sign-in, notification emails

**Type:** HITL (the sending domain must be onboarded to Cloudflare Email Sending on the owner's account)
**Labels:** —

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Email works on the `paid` profile, and the `free` profile works without it.

- The mail transport is one `send(message)` function with two implementations: Cloudflare Email (send_email binding) and `none`. The Deploy Profile chooses it.
- Email OTP sign-in is on only when a transport is configured. Rate limit: 5 codes an hour for each address.
- Notification emails follow each User's preferences from issue 18.
- Settings shows the sender and a "Send test email" action.
- Transport errors (for example the daily limit) are logged and shown to Admins. They never block the ticket change.

## Acceptance criteria

- [ ] Test with the capturing transport: each preference produces the expected emails and no others.
- [ ] Test: with the `none` transport, email OTP is not offered and notifications still reach the Inbox.
- [ ] Test: the 6th OTP request in an hour for one address is refused.
- [ ] Test: a transport error does not roll back the ticket change.
- [ ] Manual check on staging: a real notification email and a real OTP email arrive.

## Blocked by

- [18 · Inbox notifications and preferences](18-inbox-notifications.md)
