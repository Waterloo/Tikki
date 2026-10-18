# Build a Ticket App

> **Status: planned.** This guide is the contract for issues [34](issues/34-ticket-apps.md) and [35](issues/35-ticket-app-writes.md). The design is fixed. The code is not built yet.

A **Ticket App** is your own web page, shown inside a Tikki ticket. Agents see it as a card in the ticket sidebar or as a tab next to Conversation and Activity. Tikki tells your page which ticket is open and who is looking at it, and gives you a signed token that proves it.

Typical apps:

- An orders panel that shows the customer's last orders next to a payment ticket.
- A user lookup that shows the account plan, sign-up date and feature flags.
- A refund tool that issues a refund and adds "Refund issued" to the ticket.

You need no SDK. A Ticket App is a normal web page with about 20 lines of JavaScript.

## Contents

1. [How it works](#how-it-works)
2. [Quick start](#quick-start)
3. [Add the app in Tikki](#add-the-app-in-tikki)
4. [Positions](#positions)
5. [Messages](#messages)
6. [The context](#the-context)
7. [The context token](#the-context-token)
8. [Change the ticket from your backend](#change-the-ticket-from-your-backend)
9. [Security checklist](#security-checklist)
10. [Errors and edge cases](#errors-and-edge-cases)
11. [Test locally](#test-locally)
12. [FAQ](#faq)

## How it works

```
 Agent's browser                                             Your servers
┌──────────────────────────────────────────────┐
│ Tikki ticket page  (https://tikki.example)   │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │ iframe: your app (https://app.you)   │   │
│   │                                      │   │   token    ┌──────────────┐
│   │  1. sends tikki:fetch-context ─────► │   │ ─────────► │ your backend │
│   │  2. ◄──── gets tikki:context +token  │   │            │ 3. checks it │
│   │                                      │   │            │   with JWKS  │
│   └──────────────────────────────────────┘   │            └──────┬───────┘
└──────────────────────────────────────────────┘                   │
                                                 4. optional: REST │ Bearer <token>
                                         Tikki API  ◄──────────────┘
```

1. The Agent opens a ticket. Tikki loads your URL in an iframe.
2. Your page asks for the context. Tikki answers with the ticket, the requester, the Agent, and a **context token**.
3. Your page sends the token to your backend. Your backend checks the token's signature against Tikki's public keys. Now it knows that this Agent has this ticket open.
4. If the Admin gave your app write access, your backend can add a comment or change the ticket through the Tikki REST API, with the same token.

Do not trust the context in the browser alone: any page can post a message. Your backend must trust only the **checked token**.

## Quick start

A complete app as one static HTML file. It shows the ticket and the customer, and sends the token to your backend.

```html
<!doctype html>
<meta charset="utf-8">
<title>Orders</title>
<body style="font: 14px system-ui; margin: 12px">
<div id="out">Loading…</div>
<script>
  // The origin of your Tikki instance. Messages from any other origin are ignored.
  const TIKKI_ORIGIN = 'https://tikki.example.com'

  window.addEventListener('message', async (event) => {
    if (event.origin !== TIKKI_ORIGIN || event.source !== window.parent) return
    const msg = event.data
    if (msg?.type !== 'tikki:context') return

    const { ticket, requester } = msg.data
    document.getElementById('out').textContent = `${ticket.ref} · ${requester.email}`

    // Your backend checks the token and returns the orders for this customer.
    const res = await fetch('/api/orders', { headers: { authorization: `Bearer ${msg.token}` } })
    // ... render the orders ...

    // Sidebar apps: fit the card to the content (120–600 px).
    window.parent.postMessage({ type: 'tikki:resize', height: document.body.scrollHeight }, TIKKI_ORIGIN)
  })

  // Ask for the context. Tikki also sends it on its own when the frame loads.
  window.parent.postMessage({ type: 'tikki:fetch-context' }, TIKKI_ORIGIN)
</script>
```

## Add the app in Tikki

An Admin opens **Ticket Apps** in Tikki and fills in:

| Setting | Values | Notes |
|---|---|---|
| Name | Text | Shown as the card title or the tab name. Keep it short: "Orders". |
| URL | `https://...` | The page Tikki loads. Its **origin** is the token audience. `http://` works only for a loopback address (`localhost`, `127.0.0.1`, `[::1]`) on a development or test instance. It cannot be on Tikki's own origin. |
| Position | `sidebar` or `tab` | See [Positions](#positions). |
| Show on | "All Ticket Types", or "Only these types" with a checklist | For example, check "Data request" and "Payment issue". "All Ticket Types" also covers types added later. |
| Access | `read`, `comment` or `update` | What your backend may do with the token. Default `read`. See [scopes](#scopes). |
| On | On or off | Off hides the app and stops its tokens at once. |

Apps appear in the order of the admin list.

Your page must allow Tikki to frame it. If you send a CSP header, include Tikki's origin:

```
Content-Security-Policy: frame-ancestors https://tikki.example.com
```

Remove `X-Frame-Options: DENY` or `SAMEORIGIN` from that page, or the browser shows an empty frame.

## Positions

| | `sidebar` | `tab` |
|---|---|---|
| Where | A card in the ticket sidebar, below Requester | A tab after Conversation and Activity |
| Width | The sidebar width (about 280–360 px; full width on a phone) | The main column width |
| Height | Starts at 200 px. You set it with `tikki:resize`, 120–600 px | Fills the column |
| Loads | When the ticket opens | The first time the Agent opens the tab, then it stays loaded |
| Good for | Short facts: plan, last order, account status | A full tool: order history, refund form |

Design for narrow widths in both positions. On a phone, the sidebar card is full width below the conversation.

Tikki follows the Agent's light or dark mode. You get the current mode in `context.theme` and can match it.

## Messages

All messages are plain objects with a `type`. Always pass Tikki's origin as the target origin, never `'*'`.

### From your app to Tikki

| `type` | Fields | Effect |
|---|---|---|
| `tikki:fetch-context` | — | Tikki answers with `tikki:context`. Use it at start-up and when your token is close to expiry. Send a first message within 10 s of load, or Tikki shows "The app did not answer". |
| `tikki:resize` | `height` (number, px) | Sidebar only. Tikki clamps it to 120–600. Ignored for tabs. |
| `tikki:refresh` | — | Tikki reloads the ticket. Send it after your backend changed the ticket. |

Tikki ignores other types, and messages from any window other than your iframe.

### From Tikki to your app

| `type` | Fields | When |
|---|---|---|
| `tikki:context` | `data`, `token`, `expires_at` | When the frame loads, after `tikki:fetch-context`, and after the Agent changes the ticket on this page (Status, assignee, Fields, ...). A change by another person does not send it. |

## The context

`data` in `tikki:context`. The field names and shapes are the same as in the REST API (`GET /api/v1/tickets/{ref}`).

```json
{
  "version": 1,
  "app": { "id": 4, "name": "Orders", "position": "sidebar" },
  "theme": "dark",
  "agent": { "id": "u_8f2c", "name": "Sam Lee", "email": "sam@acme.com", "role": "agent" },
  "ticket": {
    "ref": "PAY-1048",
    "number": 1048,
    "url": "https://tikki.example.com/tickets/PAY-1048",
    "title": "Charged twice for order 5521",
    "priority": "high",
    "status": { "key": "open", "name": "Open", "category": "open" },
    "ticket_type": { "id": 3, "name": "Payment issue", "prefix": "PAY" },
    "team": { "id": 2, "name": "Billing" },
    "assignee": { "id": "u_8f2c", "name": "Sam Lee", "email": "sam@acme.com" },
    "fields": { "order_id": "5521", "amount": "49.00" },
    "schema_fields": [
      { "key": "order_id", "label": "Order ID", "type": "text" },
      { "key": "amount", "label": "Amount", "type": "text" }
    ],
    "channel": "api",
    "application": { "id": 1, "name": "Checkout site" },
    "created_at": "2026-10-18T09:12:44.000Z",
    "updated_at": "2026-10-18T10:03:10.000Z"
  },
  "requester": {
    "kind": "contact",
    "id": 77,
    "external_id": "cus_19ab",
    "name": "Jo Park",
    "email": "jo@example.org"
  }
}
```

Notes:

- `requester.kind` is `user` (a person in your organization: `id`, `name`, `email`) or `contact` (a customer of an Application: `id`, `external_id`, `name`, `email`). Look up your customer with `external_id` when it is set. It is the id the Application gave Tikki.
- `assignee` and `team` can be `null`.
- `fields` holds the values of the ticket's own Schema Version. Read labels from `schema_fields`. A Field without a value is missing from `fields`.
- `version` changes only for a breaking change. New fields can appear at any time; ignore what you do not know.
- The context has **no comments, attachments or Participants**. Ask the API for comments with the token ([below](#change-the-ticket-from-your-backend)).

## The context token

A JSON Web Token, signed by Tikki. It lives 5 minutes. `expires_at` in the message tells you when it ends. Ask again with `tikki:fetch-context` before that.

### Claims

| Claim | Value |
|---|---|
| `iss` | `https://tikki.example.com/api/auth` |
| `aud` | Your app's origin, for example `https://app.you.com` |
| `sub` | The Agent's User id (same as `agent.id`) |
| `tikki_app` | Your app id (same as `app.id`) |
| `tikki_ticket` | The ticket ref, for example `PAY-1048` |
| `tikki_scope` | `read`, `comment` or `update` |
| `iat`, `exp` | Issued at, expires (5 minutes later) |

### Check it on your backend

Use any JWT library that reads a JWKS. With `jose` in Node.js:

```js
import { createRemoteJWKSet, jwtVerify } from 'jose'

const TIKKI = 'https://tikki.example.com'
const jwks = createRemoteJWKSet(new URL(`${TIKKI}/api/auth/jwks`))

export async function checkTikkiToken(token) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${TIKKI}/api/auth`,
    audience: 'https://app.you.com', // your own origin, exactly
  })
  return {
    agentId: payload.sub,
    ticketRef: payload.tikki_ticket,
    scope: payload.tikki_scope,
  }
}
```

Always check `issuer`, `audience` and the expiry (`jwtVerify` checks `exp`). A token with another audience was made for another app. Refuse it.

Use the checked `sub` and `tikki_ticket`, not the values in the browser context, for any decision on your side. For example, show refunds only for the order in the checked ticket.

The token can be your app's sign-in. Browsers block third-party cookies in iframes, so a cookie session inside the frame often fails. Send the token with each request, or swap it once for your own short session.

## Change the ticket from your backend

Your backend calls the Tikki REST API with the token:

```
Authorization: Bearer <context token>
```

The API treats the call as **the Agent who has the ticket open**, through your app. Three limits apply:

- **One ticket.** Only the ticket in `tikki_ticket`. Any other ticket answers `404`.
- **Your scope.** Only the actions of your app's access level. Others answer `403`.
- **The Agent's rights.** If the Agent cannot do it in Tikki, your app cannot either.

Call the API only from your backend. The API sends no CORS headers for this, so the browser cannot use the token from any page.

### Scopes

| Scope | Allowed calls |
|---|---|
| `read` | `GET /api/v1/tickets/{ref}` · `GET /api/v1/tickets/{ref}/comments` · `GET /api/v1/tickets/{ref}/activity` |
| `comment` | All of `read`, plus `POST /api/v1/tickets/{ref}/comments` |
| `update` | All of `comment`, plus `PATCH /api/v1/tickets/{ref}` (Status, Priority, assignee and Fields) |

A token never allows: lists or search, a type change, a Team move, Participants, cancel, delete, revert, or any admin route. People do those in Tikki.

### Examples

Add an internal note (scope `comment`):

```bash
curl -X POST "https://tikki.example.com/api/v1/tickets/PAY-1048/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Refund of 49.00 issued for order 5521.", "visibility": "internal"}'
```

`visibility` is `internal` (only staff see it) or `public` (the requester sees it and is notified).

Resolve the ticket and set a Field (scope `update`):

```bash
curl -X PATCH "https://tikki.example.com/api/v1/tickets/PAY-1048" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved", "fields": {"refund_id": "re_3KQ"}}'
```

Then tell Tikki to show the change at once:

```js
window.parent.postMessage({ type: 'tikki:refresh' }, TIKKI_ORIGIN)
```

### What people see

Every change by your app appears in the ticket's Activity and audit log as **"Sam Lee via Orders"**. It makes the same webhook Event and notifications as a change in the web app. The Event has `channel: "app"`.

## Security checklist

- [ ] Check `event.origin === TIKKI_ORIGIN` and `event.source === window.parent` on every message.
- [ ] Post only to `TIKKI_ORIGIN`, never `'*'`.
- [ ] Trust nothing from the browser context on your backend. Check the token: signature, `iss`, `aud` (your origin), `exp`.
- [ ] Ask for the lowest scope that works. Most apps need `read` only.
- [ ] Keep the token out of URLs and logs. Send it in the `Authorization` header.
- [ ] Allow framing by Tikki's origin only (`frame-ancestors`).
- [ ] Show ticket text as text, not HTML. Titles, Field values and comments are written by users.

What Tikki does on its side:

- It loads your page in a sandboxed iframe (`allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox`). The frame itself cannot navigate the Tikki tab. A popup that your page opens has no sandbox; do not use its `opener`.
- It sends no referrer to your page.
- It never shows apps to Requesters and never makes tokens for them.
- It checks that your app is on with each API call. When an Admin turns your app off, its tokens stop working at once.

## Errors and edge cases

| Situation | What happens | What to do |
|---|---|---|
| Your page sends no message in 10 s | Tikki shows "The app did not answer" with Retry | Send `tikki:fetch-context` at start-up. Keep the first paint fast. Load data after you show something. |
| Token expired | API answers `401` | Send `tikki:fetch-context` and retry once. |
| Wrong ticket in the URL | `404` | Use `tikki_ticket` from the checked token. |
| Action outside your scope | `403` with code `FORBIDDEN` | Ask the Admin for a higher access level, or hide the button. |
| The Agent lost access to the ticket | `404` | Show a short message. Do not retry. |
| The app was turned off or deleted | `401` | Show a short message. |
| Too many calls | `429` with `Retry-After` | The limit is the Agent's own web limit. Wait and retry. |
| The ticket changed in Tikki | You get a new `tikki:context` | Re-render from the new data. |

Errors use the Tikki API error format:

```json
{ "error": { "code": "FORBIDDEN", "message": "...", "details": null } }
```

## Test locally

1. Run Tikki locally (see the README). It listens on `http://localhost:8787`.
2. Serve your app on another port, for example `npx serve -p 5173`.
3. In Tikki, open Ticket Apps and add `http://localhost:5173` (allowed only on a development or test instance).
4. Open any ticket as the Admin (`admin@example.com`). Your app shows in the sidebar or as a tab.
5. In your app, use `TIKKI_ORIGIN = 'http://localhost:8787'` and audience `http://localhost:5173`.

A complete example app with a backend token check is in [`examples/ticket-app/server.mjs`](../examples/ticket-app/server.mjs). Run it from the repository root:

```bash
node examples/ticket-app/server.mjs
```

It listens on `http://localhost:5173`. Set `TIKKI` when Tikki is not on `http://localhost:8787`. The card shows the context, and "Checked by the backend" shows the claims of the checked token.

## FAQ

**Can I show my app to the customer (the requester)?**
No. Ticket Apps are for staff only.

**Can my page change the ticket with a message, without a backend?**
No. Writes go only through the REST API with the token. If a message could change the ticket, one script bug on your page could change any ticket the Agent can reach.

**Can I use my Application API key instead?**
An API key reaches only the tickets that the Application created for its own customers. The context token reaches the ticket the Agent has open, whoever created it.

**Do I get comments in the context?**
No. Call `GET /api/v1/tickets/{ref}/comments` with the token. The answer has the comments the Agent can see, internal ones included.

**Can one app run in both positions?**
No. Add it twice, once for each position, if you need both.

**Can I open a link or a popup?**
Yes. Popups and `target="_blank"` links work. The frame cannot navigate the Tikki tab itself.
