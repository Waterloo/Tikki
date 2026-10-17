# 13 · Application actions for Contacts

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

An Application acts for its Contacts with the same rules as an internal Requester.

- Add a Public Comment for the Contact (with `comments:create`).
- Cancel and reopen the Contact's ticket (with `tickets:update`), with the same limits as issue 09.
- The ticket screen shows these comments as "Contact · <Application>".

## Acceptance criteria

- [ ] REST test: an Application comment is Public, and its author is the Contact through the Application.
- [ ] REST test: cancel and reopen follow the issue 09 rules for Application tickets.
- [ ] REST test: an Application without the needed permission is refused.
- [ ] REST test: an Application cannot act on another Application's ticket.

## Blocked by

- [09 · Requester self-service](09-requester-self-service.md)
- [12 · Applications, API keys, and tickets for Contacts](12-applications-and-api-keys.md)
