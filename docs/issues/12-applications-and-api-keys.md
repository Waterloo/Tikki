# 12 · Applications, API keys, and tickets for Contacts

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Other systems create tickets for their customers through the REST API, inside a strict data boundary.

- Admin "Applications" screen (design canvas): create an Application with a name, description, permissions (`tickets:create`, `tickets:read`, `tickets:update`, `comments:create`), and allowed Ticket Types. Disable and enable it.
- API keys: start with `gt_live_`, shown in full once, stored hashed. The list shows the first characters, created date, last use, and Revoke.
- A ticket created with a key has a **Contact** as Requester. A Contact is unique on (Application, external ID) and has a name and email.
- An Application can read only the tickets it created, and never Internal Comments.
- `Idempotency-Key` on create: the same key within 24 hours returns the first result.
- The OpenAPI spec is generated from the same definitions that validate requests and is served by the Worker.
- One error format: `code`, `message`, `details`.

## Acceptance criteria

- [ ] REST test: a create with a valid key and an allowed type makes a ticket with a Contact as Requester.
- [ ] REST test: a type not in the allowed list is refused. A revoked key is refused.
- [ ] REST test: the same external ID twice gives the same Contact. The same email from two Applications gives two Contacts.
- [ ] REST test: Application A cannot read Application B's tickets or any internal-only data.
- [ ] REST test: a repeated `Idempotency-Key` returns the same ticket and creates nothing new.
- [ ] REST test: the served OpenAPI document validates and lists the create endpoint.
- [ ] Only a hash of the key is in the database.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
