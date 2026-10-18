# 0004 · Ticket Apps get a signed context token, and write only through the API

**Status:** Accepted, 2026-10-18 (issues 34, 35)

## Context

The owner wants Chatwoot-style "Dashboard Apps": an external page in an iframe on the ticket, with the ticket context. Chatwoot posts the context with target origin `'*'` and gives the app no proof of who sent it. Browsers block third-party cookies in iframes, so the embedded app often cannot sign its own user in. The owner also asked whether the app may change the ticket.

## Decision

1. **Context by `postMessage`, to one origin.** Tikki posts only to the app URL's origin and accepts messages only from that iframe's window and origin.
2. **A signed context token** (JWT from Tikki's existing keys, 5 minutes, `aud` = app origin, `sub` = Agent, `tikki_ticket`, `tikki_scope`) proves to the app's backend which Agent looks at which ticket. It doubles as the app's sign-in.
3. **No write commands over `postMessage`.** Only UI messages (`fetch-context`, `resize`, `refresh`). A write command would run with the Agent's full session, so one XSS in the app could change anything the Agent can change, and the audit would show "web".
4. **Writes through the REST API with the context token.** The token is a `UserPrincipal` with `channel: 'app'`, limited in `policy.ts` to one ticket and the app's scope (`read`, `comment`, `update`). Writes go through `applyChange`.
5. **Not the Application API key.** An Application reads only its own Contacts' tickets. Opening it to all tickets is much wider than "the ticket the Agent has open now, for 5 minutes".

## Consequences

- The app can never do more than the Agent who opened it, and never on another ticket.
- A second kind of JWT now exists next to MCP access tokens. Each verifier must check `aud` and refuse the other kind; tests cover both directions.
- An app with `comment` or `update` access can write for 5 minutes after the Agent closes the ticket. That is the token lifetime, accepted.
- Revoking an app (off or deleted) stops its tokens at once, because each request checks the app.
