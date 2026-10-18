# Ticketing

A self-hosted system where people raise issues and requests, through a web app, an AI assistant, or another application, and a small team resolves them.

## People and principals

**Principal**:
Anything that can act on the system: a User, an AI acting for a User, or an Application.
_Avoid_: Actor (except in event payloads), client

**User**:
An internal person who signs in. Each User has one Role.
_Avoid_: Member, account

**Admin**:
A User who manages Ticket Types, Fields, Teams, Users, Applications, and Webhook Endpoints.

**Agent**:
A User who works on tickets. Agents can see all tickets.
_Avoid_: Handler, resolver, operator, staff

**Requester**:
The person a ticket is for. A Requester is either an internal User or a Contact.
_Avoid_: Reporter, customer, submitter

**Contact**:
An external person who never signs in. An Application creates tickets for a Contact. A Contact is unique within one Application.
_Avoid_: Customer, external user, end user

**Application**:
Another system that uses the API with its own key. It sees only the tickets it created.
_Avoid_: Integration, API client, app user

**API key**:
The secret that an Application sends to use the API. It starts with `gt_live_`, is shown once, and only its hash is kept. An Admin can revoke it.

**Support**:
How an Application sees any Agent or Admin: no name and no email.

**Contact · Application**:
How the UI and the API show an action that an Application took for its Contact: the Contact's name with the label "Contact · Application name".

**Team**:
A group of Agents that owns one or more Ticket Types. Each ticket has a Team: at first the Team of its Ticket Type, and Agents can move it to another Team.
_Avoid_: Queue, group, department

**Invite**:
An Admin's permission for one email outside the allowed domains to sign in. It expires after 30 days if nobody uses it.

**Deactivated**:
The state of a User who cannot sign in and has no sessions or tokens. The User and their history stay.

## Tickets

**Ticket**:
One issue or request. Its Ticket Number never changes.
_Avoid_: Issue, case, request (as a noun for the record)

**Ticket Number**:
The permanent number of a ticket, from one counter that all Ticket Types share. It is the ticket's identity.
_Avoid_: ID, key

**Ticket Reference**:
The Ticket Number with the prefix of the ticket's current Ticket Type, for example PAY-1048. It changes when the type changes, and every earlier reference still finds the ticket.
_Avoid_: Ticket key, display ID

**Ticket Type**:
A kind of ticket that an Admin defines, for example Bug, Data request, or Payment issue. It sets which Fields a ticket has, which Team owns it, and the prefix of its Ticket References.
_Avoid_: Category, form, template

**Archived (Ticket Type)**:
A Ticket Type that takes no new tickets. Old tickets keep it, its prefix stays reserved, and an Admin can restore it. An archived Field or option is different: it stays in the Schema Version but is not asked for on new tickets.

**Replaced prefix**:
A prefix that a Ticket Type had before an Admin changed it. It stays reserved. Old references with it still open the ticket, because lookup uses only the Ticket Number.

**Field**:
One piece of information that a Ticket Type asks for. It has a stable Field Key and a data type, and neither of them ever changes.
_Avoid_: Attribute, property, custom column

**Field Key**:
The permanent identifier of a Field. A label can change, but the key cannot.

**Schema Version**:
One snapshot of the Fields of a Ticket Type. Each ticket stays on the Schema Version it was created with, until an Agent changes its Ticket Type.
_Avoid_: Revision, form version

**Status**:
The current state of a ticket. Every Status belongs to one Status Category.

**Status Category**:
One of four fixed groups of Statuses: open, active, waiting, done. Filters and events use the category, and later Workflows add Statuses inside these categories.

**Priority**:
How urgent a ticket is: low, normal, high, or urgent. Every ticket has one.
_Avoid_: Severity, urgency

**Public Comment**:
A comment that the Requester and the source Application can see.

**Internal Comment**:
A comment that only Users can see. It never goes to a Contact or an Application.
_Avoid_: Private note, hidden comment

**Cancel**:
The Requester closes their own ticket before it is done. The Status is `closed` and the reason is "cancelled by requester".

**Reopen**:
The Requester returns a `resolved` ticket to `open` within 14 days of the resolution. After that, a new ticket is created that links to the old one.

**Soft delete**:
An Admin hides a ticket from every channel. It can be restored.
_Avoid_: Archive, trash

**Cursor**:
The opaque value in `next_cursor` that a list call sends back as `cursor` to get the next page. It marks the position of the last row.

**Similar tickets**:
Open tickets that the User can read, whose titles share words with the title typed in the New ticket form.

**Attachment**:
A file that belongs to one ticket. Anyone who can see the ticket can see its Attachments, and nobody else can.

**Upload Link**:
A short-lived, single-use link that lets a signed-in User add a file to one ticket. The AI asks for it because it cannot send files itself.

**Unattached upload**:
A file that a User uploaded before its ticket exists. Only the uploader can read it, until a new ticket claims it through a "file" Field.

**Untrusted content marker**:
The `<untrusted_content>` tags around text that Users wrote, in MCP tool results. The AI must treat that text as data, not as instructions.

**Participant**:
A User on a ticket: its Requester, its assignee, or a User someone added. On a Restricted ticket only Participants and Admins can see it.
_Avoid_: Watcher, follower, CC

**Restricted ticket**:
A ticket of a Ticket Type that is "Participants only". Only its Participants and the Admins can see it.
_Avoid_: Private ticket, confidential ticket

## Change and delivery

**Activity**:
The permanent record of each change to a ticket, with the Principal that made it.
_Avoid_: History, timeline, audit trail (for a single ticket)

**Audit log**:
The append-only record of every change, with Principal, channel, and values. Activity is the audit log of one ticket mixed with its comments. Only Erasure clears its values.

**Revert**:
A new change that sets a value back to what it was before an earlier Activity entry. It never deletes history.

**Event**:
A notice that a ticket changed. It contains the ticket before and after the change.

**Webhook Endpoint**:
A URL that receives Events. An Admin owns an endpoint for all Events. An Application owns an endpoint only for its own tickets.
_Avoid_: Hook, callback, subscription

**Application Webhook Endpoint**:
The one Webhook Endpoint of an Application. It sends only `ticket.created`, `ticket.updated` and `comment.created` for the Application's own tickets, without Internal Comments and without staff names or emails. The Admin cannot widen this.

**Delivery**:
One Event for one Webhook Endpoint, with its attempts and result. The delivery log of an endpoint lists them. They are kept 30 days.

**Signing secret**:
The secret of one Webhook Endpoint that signs each Delivery. It is shown once, on create and on rotate.

**Idempotency-Key**:
A header on a create request. The same key from the same Application within 24 hours gives the first ticket again and creates nothing.

**Inbox**:
The list of notifications for one User, inside the app.
_Avoid_: Notification center, feed

**Notice**:
One entry in a User's Inbox. It is made when a ticket changes or an endpoint fails, and never for the actor of the change.

**Erasure**:
The removal of a Contact's personal data on request. The facts that something happened stay, but the values are removed. An Admin or the Contact's Application starts it. The tickets and their numbers stay.
_Avoid_: Delete, purge, anonymization

**Workflow**:
A future set of rules that controls Statuses, transitions, and routing for a Ticket Type. Not in v1.
_Avoid_: Automation, pipeline

**Deploy Profile**:
One of two supported ways to run an instance: `paid` (email on) or `free` (email off). All other features are the same in both.
