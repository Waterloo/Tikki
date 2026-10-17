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

**Team**:
A group of Agents that owns one or more Ticket Types.
_Avoid_: Queue, group, department

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

**Attachment**:
A file that belongs to one ticket. Anyone who can see the ticket can see its Attachments, and nobody else can.

**Upload Link**:
A short-lived, single-use link that lets a signed-in User add a file to one ticket. The AI asks for it because it cannot send files itself.

## Change and delivery

**Activity**:
The permanent record of each change to a ticket, with the Principal that made it.
_Avoid_: History, timeline, audit trail (for a single ticket)

**Event**:
A notice that a ticket changed. It contains the ticket before and after the change.

**Webhook Endpoint**:
A URL that receives Events. An Admin owns an endpoint for all Events. An Application owns an endpoint only for its own tickets.
_Avoid_: Hook, callback, subscription

**Inbox**:
The list of notifications for one User, inside the app.
_Avoid_: Notification center, feed

**Erasure**:
The removal of a Contact's personal data on request. The facts that something happened stay, but the values are removed.
_Avoid_: Delete, purge, anonymization

**Workflow**:
A future set of rules that controls Statuses, transitions, and routing for a Ticket Type. Not in v1.
_Avoid_: Automation, pipeline

**Deploy Profile**:
One of two supported ways to run an instance: `paid` (email on) or `free` (email off). All other features are the same in both.
