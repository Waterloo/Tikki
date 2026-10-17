# PRD: Ticketing v1

**Label:** `ready-for-agent`
**Status:** Accepted for implementation, 2026-10-18
**Sources:** [DECISIONS.md](DECISIONS.md) (every numbered decision), [CONTEXT.md](../CONTEXT.md) (terms), [design canvas](https://claude.ai/artifact/Edi1gHaRPELu8zUnXmvUxT) (12 screens), [ui-reference.png](ui-reference.png)

Terms in **bold capitals** (Ticket, Ticket Type, Field, Contact, Application, ...) have the meaning in CONTEXT.md.

## Problem Statement

People in a small organization raise issues and requests in many places: chat messages, email, direct messages, and spoken requests. Because of this:

- Requests get lost, and nobody can see what is open, who owns it, or what its status is.
- Requesters do not know which information the team needs. Agents must ask for the order ID, the page, or the steps to reproduce again and again.
- Many people already work in an AI assistant (Claude). To raise a ticket, they must leave it, open a form, and type again what they already said.
- Other systems of the organization (for example the checkout site) have customers with problems, but no safe way to raise a ticket for a customer and send updates back.
- The kinds of request change as the team grows. A fixed form becomes wrong quickly, and changing it must not break old tickets.
- The organization wants to own the tool and its data, run it at almost no cost, and publish it as open source so other teams can run their own copy.

## Solution

A self-hosted, open-source ticketing system that runs as one Cloudflare Worker, on the Free plan or the Paid plan.

- People raise a **Ticket** in three ways: the web app, **Claude** (through a custom connector, acting as the signed-in User), and the **REST API** (other Applications, for their Contacts).
- Admins define **Ticket Types** (Bug, Data request, Payment issue, ...). Each type has its own **Fields**, a **prefix** for its Ticket References (`BUG-1047`, `PAY-1048`), and an owning **Team**. Schemas can change at any time: each change makes a new **Schema Version**, and old tickets keep their version.
- Claude reads each type's description and Fields, chooses the type, fills in what it can infer, and asks only for what is missing.
- Agents work from one list grouped by **Status**. They reply with **Public Comments** or **Internal Comments**, assign tickets, change Status, Priority and Ticket Type, and can reverse any change from the **Activity**.
- Every change creates an **Event**. Webhooks deliver it with the ticket `before` and `after`, signed, at least once. Each Application gets only the Events for its own tickets.
- Users are notified in the in-app **Inbox** and, where email is configured, by email.

**First Requester dopamine:** a user writes one sentence to Claude and, within 10 seconds, gets `BUG-1` back with the correct type and Fields.
**First Requester aha:** "what is happening with my payment issue?" in Claude gives the real status and the last public reply.
**First Admin dopamine:** from "Deploy to Cloudflare" to the first ticket in less than 10 minutes.

## User Stories

### Requester (internal User) in the web app

1. As a Requester, I want to sign in with a one-time code sent to my work email, so that I need no password.
2. As a Requester, I want to sign in with my work Google or Microsoft account when the Admin turns it on, so that I can skip the email step.
3. As a Requester, I want to choose a Ticket Type from cards with an icon and a one-sentence description, so that I know which one fits my problem.
4. As a Requester, I want the form to show only the Fields of the type I chose, so that I give exactly the information the team needs.
5. As a Requester, I want each Field to show help text, so that I know what to enter.
6. As a Requester, I want required Fields to be marked, so that I do not submit an incomplete request.
7. As a Requester, I want to see similar open tickets while I type the title, so that I can comment on an existing ticket instead of creating a duplicate.
8. As a Requester, I want to set a Priority (low, normal, high, urgent), with normal as the default, so that urgent problems stand out.
9. As a Requester, I want to attach files up to 25 MB, so that I can include screenshots and documents.
10. As a Requester, I want to get the Ticket Reference at once after creation, so that I can refer to the ticket.
11. As a Requester, I want a list of my tickets with their Status, so that I know what is open.
12. As a Requester, I want to see Public Comments on my tickets, so that I can follow the progress.
13. As a Requester, I never want to see Internal Comments, so that the team can discuss freely.
14. As a Requester, I want to edit the description and Field values while my ticket is still open, so that I can correct a mistake before an Agent starts.
15. As a Requester, I want to add comments after an Agent starts work, so that I can add information without changing the original request.
16. As a Requester, I want to cancel my ticket before it is done, so that the team does not work on something I no longer need.
17. As a Requester, I want to reopen a resolved ticket within 14 days, so that I can report that the fix did not work.
18. As a Requester, I want a reopen after 14 days to create a new ticket linked to the old one, so that old history stays clean.
19. As a Requester, I want to see tickets of types marked "visible to all internal users", so that I can find known bugs before I report them.
20. As a Requester, I want tickets of other types to stay private to me and the team, so that payment and data requests stay confidential.

### Requester through Claude (AI assistant)

21. As a Requester, I want to add the system to Claude as a custom connector with one URL, so that setup takes one minute.
22. As a Requester, I want to sign in once through OAuth when I connect, so that Claude acts as me and never with more rights than I have.
23. As a Requester, I want to describe a problem in one sentence and have Claude create the ticket, so that I do not leave my conversation.
24. As a Requester, I want Claude to choose the Ticket Type from the type descriptions, so that I do not need to know the type names.
25. As a Requester, I want Claude to ask me only for required information that it cannot infer, so that the conversation stays short.
26. As a Requester, I want Claude to ask for my confirmation before it creates or changes a ticket, so that nothing happens without my approval.
27. As a Requester, I want to ask Claude for the status of my tickets, so that I never need to open the web app.
28. As a Requester, I want to add a comment to my ticket through Claude, so that I can answer the team from the same conversation.
29. As a Requester, I want Claude to attach text content such as logs or CSV data, so that the team gets the evidence.
30. As a Requester, I want Claude to give me a short-lived upload link for binary files, so that I can attach a screenshot in the browser.
31. As a Requester, I want the upload link to require my web session and to work only once for one ticket, so that a leaked link is useless.

### Agent

32. As an Agent, I want one list of all tickets grouped by Status, with a count for each group, so that I see the whole queue at once.
33. As an Agent, I want to collapse groups such as Resolved, so that I focus on open work.
34. As an Agent, I want filters for All, Unassigned, and Assigned to me, so that I find my work quickly.
35. As an Agent, I want to filter by Ticket Type, Priority, and Field values such as Branch, so that I can work on one area.
36. As an Agent, I want to search by title, description, and Ticket Reference, so that I find a ticket that someone mentions.
37. As an Agent, I want any old Ticket Reference of a ticket to open it, so that links in old emails and chats always work.
38. As an Agent, I want to see where a ticket came from (web, Claude, or which Application), so that I understand the context.
39. As an Agent, I want to see the Field values with the Schema Version label, so that I know which form the requester saw.
40. As an Agent, I want to assign a ticket to myself with one click, so that the team knows I own it.
41. As an Agent, I want to change Status, Priority, and assignee, so that the ticket shows the real state.
42. As an Agent, I want to change the Ticket Type when the requester or Claude chose the wrong one, so that the ticket goes to the right Team and form.
43. As an Agent, I want Field values with matching keys to move to the new type, and other values to stay visible in the Activity, so that no information is lost silently.
44. As an Agent, I want the Ticket Reference to change its prefix and keep its number when the type changes, so that the number stays a stable identity.
45. As an Agent, I want the reply box to default to Internal, so that I do not send an internal note to a customer by mistake.
46. As an Agent, I want the reply box to change color and text when I switch to Public, so that I always know who will see my message.
47. As an Agent, I want to see the Contact's name, email, external ID, and Application on the ticket, so that I know who the customer is.
48. As an Agent, I want an Activity list of every change with its Principal and channel ("via Claude"), so that I know who did what.
49. As an Agent, I want to revert a change from the Activity, so that a mistake by a person or by the AI is easy to undo.
50. As an Agent, I want to use Claude for Agent operations (search, assign, change Status, comment), so that I can work from my AI assistant.
51. As an Agent, I want ticket content to reach Claude marked as untrusted, and Claude to have no delete or bulk tools, so that a malicious ticket cannot make the AI damage the queue.
52. As an Agent, I want designed empty, loading, and error states, so that I always know what the system is doing.

### Admin: Ticket Types and Fields

53. As an Admin, I want a list of Ticket Types with prefix, Field count, open tickets, Team, visibility, and version, so that I see the configuration at a glance.
54. As an Admin, I want to create a Ticket Type on one page, with nothing saved until I select Create, so that a half-finished type never reaches requesters.
55. As an Admin, I want a "when to use it" description to be required, so that requesters and Claude choose the type correctly.
56. As an Admin, I want an icon suggested from the name and a color that no other type uses, so that I make fewer decisions.
57. As an Admin, I want a prefix suggested from the name, so that I do not have to invent one.
58. As an Admin, I want a duplicate prefix or name to be blocked at once, with a link to restore an archived type that has the same name, so that I cannot create confusing types.
59. As an Admin, I want to add Fields with a label, data type, required flag, help text, and options for select types, so that the form asks for the right information.
60. As an Admin, I want the Field Key to be made from the label and locked when the type is created, so that integrations and filters never break.
61. As an Admin, I want quick-add buttons for common Fields (Branch, Due date, Screenshot), so that setup is fast.
62. As an Admin, I want a live preview of the requester card and of what Claude knows about the type, so that I see the effect before I save.
63. As an Admin, I want each save of a type's Fields to make a new Schema Version, so that old tickets keep their form.
64. As an Admin, I want to add Fields, rename labels, add or archive select options, archive Fields, and make Fields required for new tickets, so that the form can grow with the team.
65. As an Admin, I want the system to refuse a data type change or a hard delete of a Field, so that old data and queries stay valid.
66. As an Admin, I want to restore an archived Field, so that archiving is never a final mistake.
67. As an Admin, I want to change a type's prefix, with old references still working, so that I can fix a bad prefix.
68. As an Admin, I want to archive a Ticket Type, so that nobody creates new tickets of that type while old tickets keep it.
69. As an Admin, I want to set the owning Team and the "visible to all internal users" flag for each type, so that routing and privacy are correct.

### Admin: people, applications, webhooks, settings

70. As an Admin, I want only email domains in the allow list (plus invited people) to sign in, so that strangers cannot join with any Google account.
71. As an Admin, I want to invite a person from another domain, so that contractors can raise tickets.
72. As an Admin, I want to change a User's role (Admin, Agent, Requester), so that responsibilities match reality.
73. As an Admin, I want to deactivate and reactivate Users instead of deleting them, so that the Activity always shows who did what.
74. As an Admin, I want to create Teams and add Agents to more than one Team, so that ownership is clear.
75. As an Admin, I want the system to refuse to remove a Team that owns Ticket Types, so that no ticket loses its owner.
76. As an Admin, I want to create an Application with permissions and a list of allowed Ticket Types, so that each system can do only what it needs.
77. As an Admin, I want to create API keys that are shown once and stored hashed, so that a database leak does not expose keys.
78. As an Admin, I want to see each key's prefix, creation date, and last use, and to revoke it, so that I can rotate keys safely.
79. As an Admin, I want to set rate limits for each API key, so that one system cannot overload the instance.
80. As an Admin, I want to give an Application one webhook endpoint that gets only its own tickets' Events and only Public Comments, so that one Application never sees another one's customers.
81. As an Admin, I want admin webhook endpoints (for example Slack or n8n) for all Events, with an "include internal data" flag, so that team tools get the right detail.
82. As an Admin, I want to rotate a signing secret, send a test Event, and see a delivery log with the payload, so that I can set up and debug integrations.
83. As an Admin, I want a failing endpoint to show when it started to fail and the next retry, and to have "Retry now", so that I can fix it quickly.
84. As an Admin, I want an endpoint that fails for 3 days to be disabled automatically and the Admins to be notified, so that a dead endpoint does not fill the outbox.
85. As an Admin, I want to set the organization name, subtitle, and logo, so that the app looks like ours.
86. As an Admin, I want to see deployment values (address, connector URL, sign-in methods, profile, email sender) as read-only, so that I know where to change them.
87. As an Admin, I want to send a test email, so that I can check the email setup.
88. As an Admin, I want to soft-delete a ticket (spam, created by mistake) and restore it, so that cleanup is reversible.
89. As an Admin, I want to find a Contact by email or external ID and erase their personal data, so that we can respect a customer's erasure request.

### Admin: first run

90. As the first Admin, I want the first sign-in with the email in the bootstrap setting to make me Admin, so that I need no database work.
91. As the first Admin, I want three example Ticket Types and a Support Team to exist already, so that the system works before I configure it.
92. As the first Admin, I want the first screen to show the connector URL with a copy button and a suggested first message to Claude, so that I see the value at once.

### Application (another system, through the REST API)

93. As an Application, I want to authenticate with an API key, so that server-to-server calls are simple.
94. As an Application, I want to create a ticket for a Contact identified by my own external ID, so that I do not need to create a user for each customer.
95. As an Application, I want the same external ID to map to the same Contact, so that a customer's tickets stay together.
96. As an Application, I want to send an Idempotency-Key header when I create a ticket, so that a retry after a timeout does not create a duplicate.
97. As an Application, I want to read only the tickets I created, so that the data boundary is clear.
98. As an Application, I want to add comments, cancel, and reopen for my Contacts, so that customers can act through my interface.
99. As an Application, I want to upload attachments as a raw streamed body, so that large files work on the Free plan.
100. As an Application, I want my webhook to receive `ticket.created`, `ticket.updated` (with the changed Field Keys), and `comment.created` for public comments, with the full `before` and `after`, so that I can update my customer.
101. As an Application, I want every webhook to be signed with HMAC-SHA256 and to have an `event_id`, so that I can verify it and drop duplicates.
102. As an Application, I want payloads to carry both `number` and `ref`, so that I can store the stable number and show the reference.
103. As an Application developer, I want a published OpenAPI spec, cursor pagination, and one error format, so that integration is predictable.
104. As an Application developer, I want validation errors to name each Field Key, its label, the reason, and the allowed options, so that I can fix my request without guessing.
105. As an Application, I want to erase a Contact's personal data through the API, so that I can honour erasure requests from my own system.

### Notifications

106. As a User, I want an Inbox that groups notifications by day, with All and Unread filters and "Mark all as read", so that I know what needs me.
107. As a User, I want each notification to open its ticket or endpoint, so that I can act at once.
108. As a User, I want to choose which events also send me an email, while "assigned to me" is always on, so that I get enough email but not too much.
109. As an Agent, I want a notification when a ticket arrives for my Team, when I am assigned, and when someone comments on my tickets, so that nothing waits for me unnoticed.
110. As a Requester, I want a notification when my ticket is created, gets a Public Comment, or changes Status, so that I follow its progress.
111. As a User on a `free` instance with no email, I want the Inbox to still get every notification, so that the system works without email.

### Self-hoster / operator

112. As a self-hoster, I want a "Deploy to Cloudflare" button and wrangler documentation, so that I can install it on my own account.
113. As a self-hoster, I want the system to run on the Workers Free plan with email turned off, so that a small team pays nothing.
114. As a self-hoster, I want the Worker to refuse to start, with a clear error, when the domain allow list is missing for Google, Microsoft, or email sign-in, so that a configuration mistake cannot open the instance to everyone.
115. As a self-hoster, I want migrations to run automatically on each deploy, so that upgrades are one step.
116. As a self-hoster, I want staging and production environments with separate data, so that I can test changes safely.
117. As a self-hoster, I want D1 Time Travel and a nightly export to R2, so that I can restore data.
118. As a self-hoster, I want optional Sentry error tracking, on only when a DSN is set, so that I choose my own tools.
119. As a self-hoster, I want the project under the MIT license, so that I can use and change it freely.

### Security and privacy

120. As an organization, I want every action recorded in an append-only audit log with its Principal, so that we can always answer "who did what, when".
121. As an organization, I want the audit log to keep facts but not personal values, so that Erasure is possible.
122. As an organization, I want delivered webhook payloads deleted after 30 days, so that personal data does not stay in delivery logs.
123. As an organization, I want attachments in a private bucket and served only through the same access check as the ticket, with `Content-Disposition: attachment`, so that files cannot leak or run scripts in our domain.
124. As an organization, I want rate limits on sign-in (for each IP) and on email codes (for each address), so that attackers cannot guess codes or use our email for spam.

## Implementation Decisions

### Platform and shape

- One Cloudflare Worker serves the SPA (Nuxt 4, `ssr: false`, Nuxt UI), the REST API, and the MCP endpoint. Nuxt 4.6 runs on Nitro v2, so bindings come from the request context. No Durable Objects.
- Data: D1 through Drizzle, with `transaction: false`. All writes that must succeed together (a ticket change, its audit entry, and its outbox Event) go in one atomic D1 `batch()`.
- Files: one private R2 bucket.
- Two Deploy Profiles, `paid` and `free`. The only difference is the mail transport.
- CPU budget: every route stays below 5 ms CPU, so the Free plan works. No password hashing, no runtime code generation (`eval`), and no multipart parsing.
- **Build order:** first a walking skeleton (Worker + Better-Auth + MCP with one `create_ticket` tool, connected to claude.ai, deployed to staging with real migrations). This proves the two largest risks before features are built.

### Modules

Each module answers one question. They are listed with their interface in terms of behavior.

1. **Identity and access**: "who is this Principal, and what may it do?"
   - Better-Auth 1.7. Email OTP is the first sign-in method (no magic links: mail scanners use single-use links, and links break the Claude OAuth popup flow). Google, Microsoft, and generic OIDC follow. No passwords. An instance with the `none` mail transport needs at least one SSO provider.
   - Mail transports: Cloudflare Email, `none`, and `console` (development only; the Worker refuses to start with it in any other environment).
   - `@better-auth/mcp` and `@better-auth/cimd` make Better-Auth the only OAuth 2.1 authorization server for the MCP endpoint. DCR stays on as a fallback, and the legacy (stateless) protocol mode stays on, because Claude does not list MCP spec 2026-07-28. The protected-resource `resource` must equal the MCP URL exactly.
   - Three kinds of Principal: User, User via AI (same rights as the User, marked in the audit log), and Application (API key).
   - One policy function answers "may Principal P do action A on ticket T?" for every channel. The REST API, MCP tools, and UI never check permissions on their own.
   - Bootstrap Admin from the `ADMIN_EMAIL` setting. The domain allow list is required for Google, Microsoft, and email OTP, and the Worker fails to start without it.
   - Users are invited, active, or deactivated. They are never deleted.
2. **Ticket Types and Schema Versions**: "what does a ticket of this type look like?"
   - A Ticket Type has a name, a description (required), an icon, a color, a prefix, an owning Team, a visibility flag, and an archived state.
   - A prefix is 2–5 capital letters and is unique across all types, including archived ones.
   - Each save of Fields makes an immutable Schema Version. A Field has a stable key, a label, a data type, required, help text, options, and an archived flag. A key's data type never changes across versions.
   - Creation of a type makes version 1 in one step. There is no draft state.
3. **Field validator** (pure, no I/O): "is this set of values valid for this Schema Version?"
   - Input: a Schema Version and the submitted values. Output: the normalized values, or a list of errors, each with Field Key, label, reason, and allowed options.
   - It also produces JSON Schema for MCP tool inputs and OpenAPI. JSON Schema is output only; nothing validates with a JSON Schema library.
4. **Tickets**: "what is the state of this ticket, and which changes are allowed?"
   - A ticket has a number from one global counter, a Ticket Type, a pinned Schema Version, Field values (stored as one JSON object keyed by Field Key), a Status, a Priority, a Requester (User or Contact), a source (web, Claude, or an Application), an assignee, and a soft-delete marker.
   - Lookup by Ticket Reference uses only the number, so any earlier prefix still resolves.
   - A type change moves matching keys to the new type's newest version and records the other values in the Activity.
   - Requester rules: edit only while the Status Category is `open`; cancel before `done`; reopen within 14 days.
   - Statuses are rows with a fixed Status Category (open, active, waiting, done). v1 seeds five and does not let anyone edit them.
5. **Comments and Activity**: "what happened on this ticket, and who may see it?"
   - Comments are Public or Internal. Agent comments default to Internal.
   - Activity is the audit log filtered to one ticket. Each entry records the Principal, the channel, and the change. Reversible entries offer Revert, which creates a new entry.
6. **Attachments**: "store and serve one file of one ticket."
   - Raw streamed upload with the filename in a header and a required `Content-Length`; 25 MB limit.
   - Download only through the Worker, with the ticket access check and `Content-Disposition: attachment`.
   - Upload Links: single use, 15 minutes, one ticket, and the User's web session required.
7. **Events and delivery**: "who must hear about this change, and did they get it?"
   - Every ticket change writes an outbox Event in the same batch: `ticket.created`, `ticket.updated` (with `changed` Field Keys), `comment.created`. The payload has `event_id`, `type`, `changed`, `actor`, and the full ticket `before` and `after`, which contain `number` and `ref`.
   - A scheduled handler delivers Events at least once with HMAC-SHA256 signatures, retries with backoff for up to 24 hours, and disables an endpoint after 3 days of continuous failure.
   - Admin endpoints get all Events; internal data only when marked internal. An Application endpoint gets only its own tickets' Events and only Public Comments. The Admin cannot widen this.
   - Delivered payloads are deleted after 30 days.
8. **Notifications**: "which User gets which notice, and where?"
   - Fan-out follows the notification table in DECISIONS.md section 8. Every notice goes to the Inbox. Email follows each User's preferences, with "assigned to me" always on.
9. **Mail transport**: one `send(message)` function, with Cloudflare Email (Paid) and `none` for deployed instances, and `console` for local development.
10. **Erasure**: "remove one Contact's personal data."
    - Name and email become `[erased]`. The free text, Field values, and attachments of the Contact's tickets are removed, and their Activity entries lose their values. The facts stay.
11. **REST API**: `/api/v1`, OpenAPI generated from the same definitions as validation, `Idempotency-Key` on create (kept 24 hours), cursor pagination, one error format with `code`, `message`, and `details`.
12. **MCP server**: a stateless Streamable HTTP handler in the same Worker.
    - Tools for everyone: list Ticket Types, get a Ticket Type with its Fields, create a ticket, list my tickets, get a ticket, add a comment, attach text (up to about 256 KB), request an Upload Link.
    - Tools for Agents: search tickets, assign, change Status, change Priority, change Ticket Type.
    - No delete tool and no bulk tool. Write tools have MCP annotations so that Claude asks for confirmation. Ticket content is returned marked as untrusted. Every call goes through the same policy function and module code as the REST API.
13. **Web UI**: the 12 screens on the design canvas. Visual rules are in DECISIONS.md section 14.

### Schema (entities, not columns)

Users, sessions, and OAuth clients (Better-Auth); Teams and Team memberships; Ticket Types; Schema Versions; Statuses; Tickets (with Field values as JSON); Comments; Attachments; Contacts; Applications; API keys (hash and visible prefix); Webhook Endpoints; Outbox Events; Deliveries; Inbox notifications; notification preferences; idempotency records; Upload Links; organization settings; and the append-only audit log.

### Limits and configuration

- Rate limits: API key 60 requests/min (10 creates/min); User web 120/min; User through MCP 30 tool calls/min (10 writes/min); sign-in 10/min for each IP; email OTP 5/hour for each address. Admins can change limits for each key. Before implementation, confirm that the Cloudflare rate-limiting binding is available on the Free plan. If it is not, use a D1 counter for the sign-in and OTP limits only.
- Environment: identity providers, email sender, bootstrap Admin email, domain allow list, instance URL, optional Sentry DSN. Everything else is in the admin UI.

## Testing Decisions

- **A good test** drives the system through a public boundary and checks behavior that a user or an integration can observe: the HTTP response, the stored ticket as read back through the API, the Event that arrives at a receiver, the email that the transport captured. It does not check internal calls, private functions, or table layouts.
- **Seams** (agreed with the owner):
  1. **REST API**: the main seam. Real HTTP requests to the Worker in the Workers test runtime, with a real local D1 and R2. One helper creates a User session or an API key. This covers tickets, types, Fields, Schema Versions, Ticket References, permissions for every Principal, idempotency, attachments, and Erasure.
  2. **MCP endpoint**: an MCP client over Streamable HTTP with a test access token, against the same Worker. It covers the tool list and schemas, every tool, role enforcement, and repairable validation errors.
  3. **Event delivery**: call the scheduled handler directly, with a fake receiving endpoint and a clock that the test controls. It covers signatures, `before`/`after`, filtering for each Application, retries, backoff, and auto-disable.
  4. **Mail transport**: a capturing implementation. Tests check who gets which notice.
  5. **Field validator**: the only seam below the API. Table tests for every data type, required rules, archived Fields, and Schema Version rules.
  6. **End to end**: a few Playwright flows against `wrangler dev`: sign in, create a ticket in the web form, an Agent replies in public, the Requester sees it.
  7. **CPU budget**: a CI job in staging that reads the CPU time of each route from Workers Logs and fails above 5 ms.
- The OAuth connection from claude.ai is checked by hand in the walking skeleton and before each release, because Claude cannot run in CI.
- **Prior art:** none in this repository yet. Follow the Cloudflare Workers Vitest integration pattern (tests run inside the Workers runtime with local bindings).

## Out of Scope

- Workflows: custom Statuses, transitions, and rules-based routing (for example by branch).
- SLAs, automations, and reporting.
- Watchers ("CC me") and mentions.
- Kanban and Calendar views. Kanban is the first view after v1.
- Direct messages between Users.
- Multi-tenancy: one organization for each instance.
- Data residency or more than one D1 database.
- Passwords.
- Full-text search (FTS5), because it breaks `wrangler d1 export`.
- Malware scanning of attachments.
- OAuth client credentials for Applications (later, behind the same Application principal).
- Mail providers other than Cloudflare Email.
- Binary file transfer from Claude (wait for the MCP file-upload extension).
- LLM features inside the web app.
- Field-level permissions.

## Further Notes

- **Largest risks**, all tested by the walking skeleton:
  - CIMD on Workers needs a secure transport that we write ourselves (the Better-Auth docs ship only a Node version).
  - Protocol version: Better-Auth's example config rejects legacy clients, which would break Claude. Keep legacy mode on.
  - Better-Auth serves its well-known metadata under its own base path. The root `/.well-known/*` routes or the `resource_metadata` pointer in the 401 response may need extra work.
  - CPU per request on the Free plan.
- **Library facts were checked on 2026-10-18** (DECISIONS.md section 2). Many web tutorials for Better-Auth MCP describe APIs that 1.7 removed.
- Claude connectors need responses within 10 seconds, refresh-token rotation, and `invalid_grant` for a bad refresh token.
- Every decision in this PRD has a number in DECISIONS.md. A change of direction must update DECISIONS.md (or add an ADR) in the same change.
