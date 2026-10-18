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

- [x] Test with the capturing transport: each preference produces the expected emails and no others.
  Evidence: `test/worker/notice-mail.test.ts`: Team switch on and off, "Assigned to me" always on (also with the other switches off) and no email to the actor, Status switch, Public Comment switches for the Requester and the assignee, Internal Comment off by default and on after the switch is turned on. Each test checks who got no email.
- [x] Test: a Requester never gets an email about an Internal Comment.
  Evidence: `test/worker/notice-mail.test.ts`, "a Requester never gets an email about an Internal Comment" (also a stray Internal Comment notice row for a Requester is not mailed).
- [x] Test: with the `none` transport, notifications still reach the Inbox.
  Evidence: `test/worker/notice-mail.test.ts`, "transport none". `sendNoticeMail` with no transport sends nothing, the Inbox has the notice, and a later real transport does not send the old notice. Note: `readConfig` still refuses `MAIL_TRANSPORT=none` until SSO exists (issue 01), so the test calls the sender with no transport instead of booting the Worker with `none`.
- [x] Test: a transport error does not roll back the ticket change, and the Admins see it.
  Evidence: `test/worker/notice-mail.test.ts`, "a transport error keeps the change". The capture transport throws "Daily email limit reached.": the PATCH answers 200, the Status is stored, the Inbox has the notice, `GET /api/v1/settings/deployment` shows `mail.last_error`, "Send test email" answers 502, and a working send clears the error. The Settings page shows the error and the button (checked in the browser at 375 px, dark mode; `e2e/people.spec.ts` sends a test email).
- [ ] Manual check on staging: a real notification email arrives.
  Not done: cloud is deferred.

## Blocked by

- [18 · Inbox notifications and preferences](18-inbox-notifications.md)

## Not verified

- A real email through the `cloudflare` transport (staging check, deferred). The `EMAIL` binding path only adds `html` to the existing `send` call.
- The Settings screen was compared with the existing Settings page (issue 21), not with `Settings.dc.html` (not saved locally).
- e2e: `E2E_PORT=8835 pnpm e2e` passes except `self-service` and `ticket-types`, which fail with "no sign-in code for admin@example.com" (the 5 per hour limit; several specs sign in as the Admin). My e2e step reuses the sign-in in `people.spec.ts` and adds none.

## Decisions made here

- **Where it runs:** `queueNoticeMail({ ticket })` is called at the end of `createTicket`, `applyChange` and `createComment`, after the batch succeeded, so REST and MCP both send. It uses `waitUntil` from `cloudflare:workers` (no event needed). A failure is caught inside; the change is never affected.
- **Claim table `notification_mail`:** one row per notice whose email step ran. The sender claims unhandled notices of the ticket with one `INSERT ... SELECT ... RETURNING`, so a notice is mailed once and a failed email is not retried. It is a separate table because the notice writers use a positional `INSERT ... SELECT` on `notification`. The migration marks old notices as handled.
- **One query for recipients:** the claimed notices joined with the recipient, the actor, the ticket, the comment and the preference row. A NULL requester or a missing User gives no row, so no recipient (Contacts, issue 12). Deactivated Users are skipped, a Requester is never mailed an `internal_comment`, and `assigned` ignores the switch.
- **Text:** the Inbox and the email share `noticeText()`. Subject `[GEN-12] <head>` on one line. Plain text plus a small HTML part where all ticket text is escaped. No template engine. Every email links to the ticket and to the Inbox for preferences.
- **Errors:** logged with `console.error` and stored in `mail_status` (one row). Shown to Admins in Settings with the time. Cleared by the next send that works. No Inbox notice to Admins: a daily-limit error would repeat for every email, and the notice kinds are only for webhooks. Settings is the place.
- **Send test email:** `POST /api/v1/settings/mail/test` (Admin) sends to the Admin's own address and answers 502 `MAIL_SEND_FAILED` with the transport message. With `none` it answers 409 and the page shows "No email is sent".
- `GET /api/v1/settings/deployment` has `mail.last_error` (`{ message, at }` or null).
- Test hooks: `failCapturedMail()` in `mail.ts`; `settleNoticeMail()` waits for in-flight sends.
- Migration `0014_issue_19_notification_email.sql` (renumbered at merge).

## Glossary terms to add

None.

## Notes for later issues

- Issue 14: after `notifyAdmins(...)`, call `queueNoticeMail({ webhook: true })` (scope `{ webhook: true }` claims the unmailed `webhook_*` notices). If the call is not inside a request, call `await sendNoticeMail(db, { webhook: true }, ctx)` with a context from `notice-mail.ts` instead.
- Issue 12: a new notice writer needs no email code; the sender picks up every unmailed notice of the ticket. Add the Source Application or Contact recipient as a notice row for a User; Contacts without a User have no email path yet.
- Issue 20: Team members are chosen by the notice writer, so email follows them.
- Sends are parallel per change. A ticket created for a very large Team could pass the 50 subrequest limit of the Free plan; batch them if that happens.
