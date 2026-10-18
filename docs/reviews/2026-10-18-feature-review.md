# Feature review: ticketing system vs minimal help-desk tools

Scope: under 20 Requesters, 2-4 Agents, under 10 tickets a day. Claude (MCP) is the main entry.
Basis: `docs/DECISIONS.md`, `docs/PRD.md`, `docs/issues/*`, and a check of `server/` and `app/`.
Issue 29 counts as done. Judged by the house guide: YAGNI, infer instead of configure, forgiveness, no toggle as a decision.
Effort: S (under a day), M (a few days), L (a week or more). Type: gap, improvement, risk.

## Already strong

- Claude is a first-class channel. Ticket Types carry a "when to use it" text and Field help text. Validation errors name each Field Key and the allowed options (DECISIONS 4.15c, 5.10). Zendesk, Freshdesk and Jira SM make the user configure this.
- Schema Versions let a form change without breaking old tickets (4.4-4.8). GitHub Issues, Linear and osTicket have nothing like it.
- One policy function guards REST, MCP and UI. Ticket text reaches Claude marked as untrusted. There is no delete or bulk tool (3.21, 5.4, 5.12).
- Every change has an Activity entry and a Revert, and the audit log keeps facts but lets Erasure remove personal values (4.25, 9.4-9.5). Most small tools have no revert and no erasure.
- Agent comments default to Internal, and the reply box changes color for Public (4.18). Reliable webhooks with an outbox, Standard Webhooks signing and a delivery log (8.4, 8.13, 8.17).

## Do next

### 1. Backups and restore are not built (risk, Effort M, Value high)
- **What:** Build issue 24 backup part: the nightly D1 export to R2, a tested restore, and a LICENSE file.
- **Why it matters here:** One D1 database holds all tickets and the audit log. If it is lost, the team loses its record. A new restore also brings back erased personal data, so the restore doc must say: run Erasure again after a restore.
- **Evidence:** DECISIONS 11 and PRD story 117 promise Time Travel and a nightly export. Issue 24 is Deferred. The Cron handler (`server/plugins/outbox.ts`) only runs the outbox and deletes old counters. No LICENSE file exists in the repo (PRD story 119, DECISIONS 12.2).
- **Note:** A Worker cannot run `wrangler d1 export`. It needs the D1 export REST API and an API token secret. Say so in the issue.

### 2. Free profile cannot start; email is a single point of failure (risk, Effort M, Value high)
- **What:** Do issue 25 (SSO) before any public release, and make a sign-in failure visible.
- **Why it matters here:** On the Paid profile, sign-in and the Claude connector both depend on one email code. If Cloudflare Email fails or hits a limit, nobody can sign in, and a failed email is not retried.
- **Evidence:** `server/utils/config.ts:90` refuses `MAIL_TRANSPORT=none` ("SSO is not available yet"). DECISIONS 2.5 and PRD story 113 say Free runs with email off. DECISIONS 8.28 and 8.30: no retry, error only shown in Settings.
- **Cheapest step:** Google or Microsoft SSO as the second method, plus an Admin notice in the Inbox when OTP mail fails (a daily-limit error is the exception in 8.30; show it once per hour, not per mail).

### 3. Claude can create duplicates (gap, Effort S, Value high)
- **What:** Make `create_ticket` check for similar open tickets and return them, or say in its tool description to call `search_tickets` first.
- **Why it matters here:** Claude is the main entry. People ask the same thing in different words ("login broken" twice in one morning). The web form already shows similar tickets (13.6, `tickets/similar.get.ts`). The MCP path does not.
- **Evidence:** `server/utils/mcp.ts` has no "similar" logic (grep finds none). Duplicates are the top noise source in small queues.
- **Shape (no new UI):** if the new title has at least 2 matching words with an open ticket the user can read, create still works, but the result adds "Possible duplicate: BUG-12". Claude then tells the user. No settings.

### 4. No inferred Status changes (improvement, Effort S, Value high)
- **What:** Move Status by rule, with no setting: a Requester Public Comment on `waiting` returns it to `open`; the first Public Comment or assignment on an `open` ticket moves it to `in_progress`. Every move is a normal Activity entry and can be reverted.
- **Why it matters here:** With 2-4 Agents, a ticket in `waiting` that gets a reply is silently stuck. The board then lies. Linear, Help Scout and Zendesk all do this.
- **Evidence:** No transition logic exists. The only Status writes in `server/utils/tickets.ts` are the initial `open` (line 384) and explicit changes. DECISIONS 4.27 says only that a comment sets `updated_at`.
- **Fits the guide:** "What can the system infer" and "Forgiveness" (Revert exists).

### 5. Auto-close resolved tickets after 14 days (gap, Effort S, Value medium)
- **What:** The existing Cron moves `resolved` tickets to `closed` after 14 days. No setting.
- **Why it matters here:** The Requester reopen window is 14 days (4.22). After that, a reopen creates a new ticket (4.36). So a `resolved` ticket after day 14 has no meaning, and it stays in the queue forever, because `closed` is set only by hand.
- **Evidence:** The cron has no ticket job (`server/plugins/outbox.ts`). 4.35: a `closed` ticket cannot be reopened, which matches. Use the same 14-day number and write an Activity entry ("auto-closed").

### 6. Slack-ready webhooks (gap, Effort S, Value medium-high)
- **What:** When an Admin endpoint URL is `hooks.slack.com/...`, send a Slack message (`{"text": "BUG-12 assigned to Ana: <link>"}`) instead of the signed JSON. Infer it from the URL. Add no toggle.
- **Why it matters here:** The Webhooks page text and placeholder say "Slack #support-desk" (`app/pages/webhooks.vue:236,390`). Slack incoming webhooks accept only Slack-shaped JSON, so the current signed payload fails there without n8n in between. A small team lives in chat. The Inbox is a place people must open.
- **Evidence:** No Slack-specific code exists (grep). One format is enough for v1; do Teams or Discord only when asked.

### 7. Claude cannot answer "how are we doing?" (gap, Effort M, Value medium)
- **What:** One read-only REST endpoint and one MCP tool `ticket_stats`: open count by Status and Type, created and resolved in the last 7 or 30 days, median time to first Public reply, median time to resolve.
- **Why it matters here:** The team lead has no way to see if replies are slow. `search_tickets` returns at most 50 rows and has no counts. A dashboard is too much; one answer Claude can read out is enough.
- **Evidence:** DECISIONS 15 and the PRD put "reporting" out of scope. No `resolved_at` or first-reply column exists, but `audit_log` has `status_changed` entries with times, so the numbers can come from it with no new table.
- **Guide check:** This is the "no UI at all" option. Do not build charts.

### 8. Stale uploads and Upload Links stay forever (risk, Effort S, Value medium)
- **What:** Purge unattached uploads older than 24 hours, and used or expired Upload Links older than 7 days, in the existing Cron.
- **Why it matters here:** R2 storage grows without bound. Unattached files hold personal data that no Erasure reaches.
- **Evidence:** DECISIONS 16 lists it as an open question ("Add a cleanup before production?"). Answer: yes. The cron already purges old counters and deliveries (9.3).

## Later

- **Comment edit and retract (improvement, M, medium).** There is no PATCH or DELETE on comments (`server/api/v1/tickets/[ref]/comments/` has only a GET). A typo or a wrong-audience Public comment cannot be fixed. Allow author edit or retract for 15 minutes, with an Activity entry and a `comment.updated` Event. Needs a decision on the webhook contract, so not S.
- **Email reply and email-in (gap, L, medium).** Needed only for people outside Claude. Notification emails already carry `[GEN-12]` in the subject (8.29), so a later inbound `email()` handler can match on it. MIME parsing may break the 5 ms CPU budget on Free (2.6); it is fine on Paid. Do it when a real user asks, and only for replies to existing tickets first.
- **Duplicate and related links (gap, S-M, medium).** Today the only link is "reopened from" (issue 09). Add one relation, "duplicate of BUG-12", that closes the ticket with a Public Comment pointing to the original. Do not add merge, parent/child or a link graph at this scale.
- **Admin audit view (gap, S, medium).** The audit log exists, but the UI shows it only as per-ticket Activity. Changes to Ticket Types, roles, Teams and invites have no screen. Add a read-only list for Admins, with filter by subject.
- **Admin data export (gap, S, medium).** A JSON or CSV export of tickets and comments for the Admin. It supports the open-source promise ("you own your data") and gives a second safety net beside the D1 backup. Streamed, to stay within CPU.
- **Participants as watchers (improvement, S, low-medium).** A User can already be added to a ticket as a Participant (issue 27, `participants` routes), but notices go to Participants only on Restricted tickets (`notifications.ts:69-73`). Decide: either a Participant on any ticket gets the Public Comment notice, or rename the concept. DECISIONS 15 says "no watchers", which now reads as wrong.
- **Accessibility pass (risk, S, medium).** Nuxt UI gives good defaults and `app/` has 144 aria or sr-only hits, but issues 06-23 list "not verified" for dark mode and 375 px (DECISIONS 16). Add one axe check to the Playwright flow and keyboard-test the ticket page.
- **Daily digest through Claude (gap, S, low-medium).** Do not build a digest email. Instead, make a saved prompt text on the first-run screen: "show my open tickets by priority". This costs nothing, because `search_tickets` supports `assignee: me` and `open_only`.
- **Saved views (gap, S, low).** Search and filters are in the URL (14.9), so a browser bookmark is a saved view. Reconsider only if two Agents ask for it.
- **Team queue filter (improvement, S, medium).** Issue 29 adds a Team filter to the list. Make "my Teams" the default filter for an Agent on first visit, with no setting (DECISIONS 16 asks if a Team should filter the queue).
- **Admin visibility of mail failure (improvement, S, low).** Keep as is until item 2 is done.

## Do not build

- **SLA timers, due dates and escalations.** At under 10 tickets a day, a person sees an old ticket. `ticket_stats` (item 7) gives the number. Due dates would also need a Calendar view (DECISIONS 15).
- **Round-robin or rules-based assignment.** With 2-4 Agents, the Team notice plus "assign to me" is enough (4.14). Rules wait for the Workflows project.
- **Canned replies and macros.** Claude writes the reply text itself. A macro library is a settings screen that Claude makes unneeded.
- **@mentions.** Participants (above) cover "bring in a colleague". Mentions need parsing, notices and a picker for 2-4 people.
- **CSAT surveys.** With under 10 tickets a day and internal Requesters, a person can just ask. Contacts never get email (8.27).
- **Public status page or customer portal.** Contacts never sign in (3.7). Applications show status to their own customers by webhook.
- **Merge tickets, parent/child, custom dashboards, tags and labels.** Fields and Types already model this. Tags would be a second taxonomy.
- **Satisfaction, knowledge base, live chat, time tracking.** Not the problem (PRD problem statement).
- **A "priority inference" feature.** Claude already sets Priority from context when it calls `create_ticket`. The Type description is the place to tell it how.
- **A settings toggle for any of items 4-6.** Each has one right default. A toggle only moves the decision to the Admin.

## Contradictions between docs and code

1. **Free profile.** DECISIONS 2.5 and PRD story 113 say "runs on Free with email off". `server/utils/config.ts:90` refuses `MAIL_TRANSPORT=none` until SSO exists. The issue README admits it ("Issue 25 must be done before a public release"). PRD story 2 and 113 stay unmet until then. Update 2.5 to say it.
2. **Backups.** DECISIONS 11 and PRD story 117 are written as facts. Nothing is built (issue 24 Deferred). The README row says Deferred, but a reader of DECISIONS 11 would not know.
3. **Watchers.** DECISIONS 15 and the notification table say "no watchers". Issue 27 adds Participants that a User can add to any ticket (CONTEXT.md line 133). The word "watcher" is not used, but the behavior on Restricted tickets is the same. Say which one is true for normal tickets.
4. **LICENSE.** DECISIONS 12.2 says MIT. The repo has no LICENSE file.
5. **Team and queue.** DECISIONS 16 says a Team "does not filter the queue of its Agents". Issue 29 adds a Team filter on the list. Close that open question or reword it as "the filter is not the default".
6. **Reporting vs Slack.** The Webhooks page tells Admins to send events to Slack. The payload is not a Slack payload, so the sentence is not true without n8n (item 6).
7. **Lifecycle end.** DECISIONS 4.22 (14-day reopen) imply a lifecycle that ends in `closed`. No code ever sets `closed` except a person (item 5).

## Top risks (short)

1. No backup or restore, and a restore brings back erased personal data (item 1).
2. Sign-in depends on one email code; Free profile cannot start; no SSO (item 2).
3. Duplicate tickets from Claude, and stale `waiting` / `resolved` tickets (items 3, 4, 5). Unattached R2 uploads grow forever (item 8).
