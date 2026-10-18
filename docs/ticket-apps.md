# Build a Ticket App

A **Ticket App** is your own web page in Tikki. Agents see it inside a ticket, as a card in the ticket sidebar or as a tab next to Conversation and Activity. It can also have a full page outside any ticket, in the **Apps** menu of the main sidebar. Each placement has its own URL. Tikki tells your page who is looking at it (and in a ticket, which ticket is open), and gives you a signed token that proves it.

Typical apps:

- An orders panel that shows the customer's last orders next to a payment ticket.
- A user lookup that shows the account plan, sign-up date and feature flags.
- A refund tool that issues a refund and adds "Refund issued" to the ticket.
- A timesheet page with the time of every ticket, by ticket or by person.

You need no SDK. A Ticket App is a normal web page with about 20 lines of JavaScript.

## Contents

1. [How it works](#how-it-works)
2. [Quick start](#quick-start)
3. [Add the app in Tikki](#add-the-app-in-tikki)
4. [Manifest](#manifest): describe your app in one JSON file
5. [Placements](#placements)
6. [Messages](#messages)
7. [The context](#the-context)
8. [The context token](#the-context-token)
   - [App pages](#app-pages): the page context and the page token
9. [Change the ticket from your backend](#change-the-ticket-from-your-backend)
10. [Security checklist](#security-checklist)
11. [Errors and edge cases](#errors-and-edge-cases)
12. [Test locally](#test-locally)
13. [FAQ](#faq)

## How it works

![The Tikki ticket page loads your app in an iframe. 1: your app sends tikki:fetch-context. 2: it gets tikki:context and the token. 3: your backend checks the token with Tikki's public keys. 4: optional, your backend calls the Tikki REST API with the token.](assets/ticket-apps-flow.svg)

1. The Agent opens a ticket. Tikki loads the URL of each placement in its own iframe.
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

An Admin opens **Ticket Apps** in Tikki. There are two ways to add an app:

- **Add from manifest:** the Admin pastes the address of your [manifest](#manifest). Tikki reads the name, the URLs, the icons and the access from it. The Admin chooses the rest.
- **Add app:** the Admin fills in the form below.

The form has these settings:

| Setting | Values | Notes |
|---|---|---|
| Name | Text | Shown as the card title or the tab name. Keep it short: "Orders". |
| Icon | A built-in icon and color, or an uploaded image | Shown on the card title, the tab and the admin list. Built-in: the Lucide icons and colors of Ticket Types (default: app window, neutral). Image: a light image and an optional dark image. PNG, WebP or SVG, 256 KB at most each, square is best (shown in a square box). Without a dark image, the light one shows in dark mode. Tikki stores the files and serves them to signed-in Agents and Admins. It never loads an icon from your site, so your site cannot see who uses Tikki and when. |
| Sidebar URL | `https://...` or empty | A card in the ticket sidebar. |
| Tab URL | `https://...` or empty | A tab next to Conversation and Activity. |
| Page URL | `https://...` or empty | A page in the Apps menu of the main sidebar. See [App pages](#app-pages). |
| Show the page to Requesters | On or off | Default off: only Agents and Admins see the page. On: Requesters also see it. Only for the page: the sidebar card and the tab are always for staff only. Needs a page URL. |
| Show on | "All Ticket Types", or "Only these types" with a checklist | For example, check "Data request" and "Payment issue". "All Ticket Types" also covers types added later. |
| Access | `read`, `comment` or `update` | What your backend may do with the token. Default `read`. See [scopes](#scopes). A lower access applies at once, also to tokens made before. A higher access applies to new tokens only. |
| On | On or off | Off hides the app and stops its tokens at once. |

Set at least one URL. A placement is on when its URL is set; see [Placements](#placements). For each URL:

- Its **origin** is the token audience for that placement. The URLs can be on different origins.
- It must use `https://`. `http://` works only for a loopback address (`localhost`, `127.0.0.1`, `[::1]`) on a development or test instance.
- It cannot be on Tikki's own origin.

Apps appear in the order of the admin list, in the ticket and in the Apps menu.

Your page must allow Tikki to frame it. If you send a CSP header, include Tikki's origin:

```
Content-Security-Policy: frame-ancestors https://tikki.example.com
```

Remove `X-Frame-Options: DENY` or `SAMEORIGIN` from that page, or the browser shows an empty frame.

## Manifest

Publish one JSON file that describes your app, for example at `https://time.example.com/tikki-app.json`. The Admin pastes this address in **Ticket Apps → Add from manifest**, checks a preview, and approves. Later, the Admin can check it again for updates.

```json
{
  "tikki_app": 1,
  "name": "Time tracking",
  "description": "Log time on tickets. Timesheet for the team.",
  "urls": {
    "sidebar": "https://time.example.com/sidebar",
    "tab": "https://time.example.com/tab",
    "page": "https://time.example.com/timesheet"
  },
  "icons": { "light": "/icon-light.svg", "dark": "/icon-dark.svg" },
  "access": "comment"
}
```

### Keys

| Key | Required | Value |
|---|---|---|
| `tikki_app` | Yes | The format version. Only `1` is known. Tikki refuses any other version. |
| `name` | Yes | Text, at most 40 characters. The card title, the tab name and the page title. |
| `description` | No | Text, at most 200 characters. The Admin sees it in the preview and in the list of apps. |
| `urls` | Yes | An object with `sidebar`, `tab` and `page`. Set at least one. Each URL follows the rules of [Add the app in Tikki](#add-the-app-in-tikki). See [Placements](#placements). |
| `icons` | No | An object with `light` and an optional `dark`. Each is the URL of a PNG, WebP or SVG file, 256 KB at most. Without a dark icon, the light one shows in dark mode. Without `icons`, the built-in app icon shows. |
| `access` | No | `read`, `comment` or `update`: the access your app asks for. Default `read`. See [scopes](#scopes). |

Rules:

- A relative URL resolves against the manifest URL. With the manifest at `https://time.example.com/tikki-app.json`, `/icon-light.svg` is `https://time.example.com/icon-light.svg`.
- Tikki ignores keys it does not know, so you can add keys for a later version. A known key with a wrong type is an error that names the key, for example `urls.tab`.
- Serve the manifest and the icons with `200`, over `https://`. On a development instance, `http://localhost` also works.

### How Tikki reads it

Tikki fetches the manifest and the icons on its own server, never in the Admin's browser:

- Only `https://` addresses. A private, loopback or link-local address is refused (on a development instance, a loopback address is allowed).
- At most 64 KB for the manifest, and 256 KB for each icon. The manifest must be valid JSON.
- A redirect is followed only to the same origin. Give the final address.
- Tikki waits at most 5 seconds for each file.
- Tikki copies the icons into its own storage. Browsers load the icons from Tikki, never from your site.

Each problem shows to the Admin with its reason, and nothing is saved:

| Problem | The Admin sees |
|---|---|
| The server cannot be reached, or does not answer in 5 seconds | Tikki could not reach the server, with the cause |
| A status other than `200` | The server answered with that status |
| The manifest is larger than 64 KB | The manifest must be 64 KB or smaller |
| Not JSON, or not a JSON object | The manifest is not valid JSON |
| `tikki_app` missing or not `1` | The key `tikki_app`, with the unknown version |
| `name` or `urls` missing, or no URL in `urls` | The key and "Required" |
| A bad URL | The key, for example `urls.tab`, and the reason, for example "Must use https." |
| A bad icon | The key, for example `icons.dark`, and the reason: not found, too large, or not a PNG, WebP or SVG file |

### What the Admin approves

The preview shows the name, the description, both icons on a light and a dark background, each placement with its URL, and the access the app asks for. The Admin then chooses:

- the Ticket Types where the app shows ("Show on"),
- "Show the page to Requesters", when the app has a page,
- the access: **the level the app asks for, or lower. Never higher.**

Then the Admin selects **Add app**. Tikki reads the manifest again and saves the app only when it is the same as in the preview. The app keeps the manifest URL. The audit log records the manifest URL with the new app.

The manifest asks; the Admin grants. While the app has a manifest, the Admin cannot grant more than the manifest asks for, also not in the edit form.

### Updates

Tikki never checks for updates by itself, and nothing changes without the Admin. To publish a change, change the manifest. Then the Admin selects **Check for updates** on the app:

1. Tikki fetches the manifest and the icons again, with the same rules.
2. Tikki shows what changed since the manifest the Admin approved: the name, the description, each URL, each icon (also new bytes at the same URL), and the requested access.
3. Two changes show as a **warning**, and the Admin must confirm them:
   - a URL on an origin that no URL of the approved manifest had. Tokens for that placement go to the new origin.
   - a higher requested access.
4. The Admin selects **Apply update** or **Ignore**.

When the Admin applies the update:

- Only the keys that changed in the manifest change on the app. A key that the Admin changed in Tikki and the manifest did not change stays as the Admin set it.
- The granted access never goes up by itself. If the app asks for more, the Admin can raise it in the same step, up to the new requested level.
- If the app asks for less, the granted access goes down to the new requested level.
- The audit log records the changed keys, before and after.

A failed check changes nothing and is not recorded.

## Placements

One app can show in more than one placement. Each placement loads its own URL, so a sidebar card can be a small page that loads fast, and the tab can be a full tool on another host.

Tikki adds `placement=sidebar`, `placement=tab` or `placement=page` to the query of the URL. It keeps the rest of the query you wrote; a `placement` already in your URL is replaced. For example, `https://orders.you.com/tikki?view=compact` loads as `https://orders.you.com/tikki?view=compact&placement=sidebar`. The context has the same value in `app.placement`, and the token in `tikki_placement`. On your backend, use the checked token, not the query.

| | `sidebar` | `tab` | `page` |
|---|---|---|---|
| Where | A card in the ticket sidebar, below Requester | A tab after Conversation and Activity | `/apps/{id}`, from the Apps menu of the main sidebar. Outside any ticket |
| Who | Agents and Admins | Agents and Admins | Agents and Admins; also Requesters when "Show the page to Requesters" is on |
| Width | The sidebar width (about 280–360 px; full width on a phone) | The main column width | The main area (full width on a phone) |
| Height | Starts at 200 px. You set it with `tikki:resize`, 120–600 px | Fills the column | Fills the main area under the page header |
| Loads | When the ticket opens | The first time the Agent opens the tab, then it stays loaded | When the User opens the page |
| Context | Ticket context, ticket token | Ticket context, ticket token | [Page context, page token](#app-pages) |
| Good for | Short facts: plan, last order, account status | A full tool: order history, refund form | A tool across tickets: a timesheet, a report |

Design for narrow widths in all placements. On a phone, the sidebar card is full width below the conversation.

Tikki follows the Agent's light or dark mode. You get the current mode in `context.theme` and can match it.

Set `color-scheme` on your page to match `theme` (`:root { color-scheme: dark }` in dark mode). The browser paints a frame opaque when its color scheme differs from the page around it, so without it your card shows as a white box in dark mode.

## Messages

All messages are plain objects with a `type`. Always pass Tikki's origin as the target origin, never `'*'`.

### From your app to Tikki

| `type` | Fields | Effect |
|---|---|---|
| `tikki:fetch-context` | — | Tikki answers with `tikki:context`. Use it at start-up and when your token is close to expiry. Send a first message within 10 s of load, or Tikki shows "The app did not answer". |
| `tikki:resize` | `height` (number, px) | Sidebar only. Tikki clamps it to 120–600. Ignored for tabs. |
| `tikki:refresh` | — | Tikki reloads the ticket. Send it after your backend changed the ticket. Ignored on a page. |
| `tikki:navigate` | `path` (string) | Tikki opens this Tikki path in the same tab, for example `/tickets/PAY-1048` or `/apps/4`. Works from every placement. See below. |

Tikki ignores other types, and messages from any window other than your iframe.

`tikki:navigate` accepts only a path that starts with `/tickets/` or `/apps/`, with no scheme, no `//`, no backslash and no white space. Tikki resolves `..` first, so `/tickets/../sign-out` is ignored too. It ignores every other path without an answer. To open your own site, use a link with `target="_blank"`.

```js
window.parent.postMessage({ type: 'tikki:navigate', path: '/tickets/PAY-1048' }, TIKKI_ORIGIN)
```

### From Tikki to your app

| `type` | Fields | When |
|---|---|---|
| `tikki:context` | `data`, `token`, `expires_at` | When the frame loads, after `tikki:fetch-context`, after the Agent changes the ticket on this page (Status, assignee, Fields, ...), and when the color mode changes. A change by another person does not send it. On a page, `data` is the [page context](#the-page-context). |

## The context

`data` in `tikki:context` for the `sidebar` and `tab` placements. A page gets the [page context](#the-page-context). The field names and shapes are the same as in the REST API (`GET /api/v1/tickets/{ref}`).

```json
{
  "version": 1,
  "app": { "id": 4, "name": "Orders", "placement": "sidebar" },
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

- `app.placement` is `sidebar` or `tab`: the frame that gets this context. An app with both URLs has two frames, and each gets its own context and token.
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
| `aud` | The origin of the URL of this placement, for example `https://app.you.com` |
| `sub` | The Agent's User id (same as `agent.id`) |
| `tikki_app` | Your app id (same as `app.id`) |
| `tikki_placement` | `sidebar` or `tab` (same as `app.placement`). A page token has `page`: see [App pages](#app-pages) |
| `tikki_ticket` | The ticket ref, for example `PAY-1048` |
| `tikki_scope` | `read`, `comment` or `update`: the app's access when Tikki made the token |
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

Always check `issuer`, `audience` and the expiry (`jwtVerify` checks `exp`). A token with another audience was made for another app, or for another placement of your app on another origin. Refuse it. If your sidebar and tab are on two origins, each backend checks its own origin.

Use the checked `sub` and `tikki_ticket`, not the values in the browser context, for any decision on your side. For example, show refunds only for the order in the checked ticket.

The token can be your app's sign-in. Browsers block third-party cookies in iframes, so a cookie session inside the frame often fails. Send the token with each request, or swap it once for your own short session.

## App pages

An app with a page URL gets a page at `/apps/{id}` in Tikki, outside any ticket, with an entry in the **Apps** menu of the main sidebar. The page shows the app's name as its title, and your frame fills the main area under it. Agents and Admins see each page. Requesters see a page only when the Admin turns on "Show the page to Requesters". For anyone else, Tikki shows "No app page here" and makes no token.

### The page context

`data` in `tikki:context` on a page. No `ticket` and no `requester`: a page is outside any ticket.

```json
{
  "version": 1,
  "app": { "id": 4, "name": "Timesheet", "placement": "page" },
  "theme": "dark",
  "user": { "id": "u_8f2c", "name": "Sam Lee", "email": "sam@acme.com", "role": "agent" }
}
```

`user.role` is `admin`, `agent` or `requester`. Note the key: a page has `user`, a ticket placement has `agent`.

### The page token

The page gets a token like the other placements, with other claims:

| Claim | Value |
|---|---|
| `iss` | `https://tikki.example.com/api/auth` |
| `aud` | The origin of the page URL |
| `sub` | The User id (same as `user.id`) |
| `tikki_app` | Your app id |
| `tikki_placement` | `page` |
| `tikki_role` | `admin`, `agent` or `requester`: the User's role when Tikki made the token |
| `iat`, `exp` | Issued at, expires (5 minutes later) |

**The page token proves who the User is, and nothing more.** It has no `tikki_ticket` and no `tikki_scope`. The Tikki REST API and `/mcp` answer `401` to it, so your page cannot read or change any ticket through Tikki. Your backend checks it as in [Check it on your backend](#check-it-on-your-backend), with your page's origin as the audience, and then uses `sub` and `tikki_role` for its own rules. For example, a timesheet shows an Agent their own hours and an Admin the hours of everyone.

The role is the role at the time Tikki made the token, so a role change applies within 5 minutes. A page that needs ticket data stores it itself. For example, the timesheet saves the ticket title when a sidebar card logs time.

Always check `tikki_placement` on your backend. If your sidebar and your page are on one origin, both tokens have the same `aud`: a sidebar token has a ticket, a page token has none.

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

A token never allows: lists or search, a type change, a Team move, a description edit, Participants, attachments, cancel, delete, revert, or any admin route. People do those in Tikki. These routes answer `403`, or `401` for a route that is only for the Tikki web app.

Tikki uses the lower of `tikki_scope` and the app's access now. So when an Admin lowers the access, the old tokens lose the higher rights at once.

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

Every change by your app appears in the ticket's Activity as **"Sam Lee (via Orders)"**, and a comment shows the chip **"via Orders"** next to the Agent's name. If the app is deleted later, it shows "via a Ticket App". The audit log records the Agent and the app.

A change by your app makes the same webhook Event and notifications as a change in the web app. The Event has `channel: "app"`, and its `actor` names the app:

```json
{ "kind": "user", "id": "u_8f2c", "name": "Sam Lee", "channel": "app", "ticket_app": { "id": 4, "name": "Orders" } }
```

The webhook of an Application gets `{ "kind": "support" }` as the actor, without the Agent or the app.

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
- It never shows a sidebar card or a tab to Requesters and never makes ticket tokens for them. A Requester sees an app page, and gets a page token, only when the Admin shows that page to Requesters.
- A page token has no ticket. The REST API and `/mcp` refuse it.
- It checks your app with each API call: it must be on and still shown on the ticket's type, and `aud` must be the origin of the URL of `tikki_placement`. When an Admin turns your app off, deletes it, or removes or moves the URL of a placement, the tokens of that placement stop working at once.
- It checks the Agent with each API call. A deactivated Agent, or one who is now a Requester, makes the token stop.

## Errors and edge cases

| Situation | What happens | What to do |
|---|---|---|
| Your page sends no message in 10 s | Tikki shows "The app did not answer" with Retry | Send `tikki:fetch-context` at start-up. Keep the first paint fast. Load data after you show something. |
| Token expired | API answers `401` | Send `tikki:fetch-context` and retry once. |
| Wrong ticket in the URL | `404` | Use `tikki_ticket` from the checked token. |
| Action outside your scope | `403` with code `FORBIDDEN` | Ask the Admin for a higher access level, or hide the button. |
| The Agent lost access to the ticket | `404` | Show a short message. Do not retry. |
| The app was turned off or deleted, no longer shows on this Ticket Type, or the URL of this placement was removed or moved to another origin | `401` | Show a short message. |
| The Agent was deactivated or is no longer an Agent | `401` | Show a short message. |
| A page token sent to the Tikki REST API or `/mcp` | `401` | A page token cannot read tickets. Store the data you need in your app. |
| `tikki:navigate` with a path that is not `/tickets/...` or `/apps/...` | Nothing | Send a Tikki path, or open your own link with `target="_blank"`. |
| You changed your manifest | Nothing, until the Admin checks for updates and applies them | Tell the Admin. A new origin or a higher access needs their confirmation. |
| Too many calls | `429` with `Retry-After` | The limit is the Agent's own web limit. Wait and retry. |
| The ticket changed in Tikki | You get a new `tikki:context` | Re-render from the new data. |

Errors use the Tikki API error format:

```json
{ "error": { "code": "FORBIDDEN", "message": "...", "details": null } }
```

## Test locally

1. Run Tikki locally (see the README). It listens on `http://localhost:8787`.
2. Serve your app on another port, for example `npx serve -p 5173`.
3. In Tikki, open Ticket Apps and add `http://localhost:5173` as the Sidebar URL, the Tab URL, the Page URL, or more than one (allowed only on a development or test instance).
4. Open any ticket as the Admin (`admin@example.com`). Your app shows in the sidebar, as a tab, or both. A page shows in the Apps menu of the main sidebar.
5. In your app, use `TIKKI_ORIGIN = 'http://localhost:8787'` and audience `http://localhost:5173`.
6. To test your manifest, serve it from the same server, for example `http://localhost:5173/tikki-app.json`, and use **Add from manifest**. On a development instance, Tikki can fetch it from a loopback address.

A real example with a database, writes and dark mode is the time tracking app in [`examples/time-tracking/`](../examples/time-tracking/README.md).

A complete example app with a backend token check is in [`examples/ticket-app/server.mjs`](../examples/ticket-app/server.mjs). Run it from the repository root:

```bash
node examples/ticket-app/server.mjs
```

It listens on `http://localhost:5173`. Set `TIKKI` when Tikki is not on `http://localhost:8787`. The card shows the context, and "Checked by the backend" shows the claims of the checked token.

## FAQ

**Can I show my app to the customer (the requester)?**
Only a page, and only a Requester in your organization (a User, not a Contact of an Application). The Admin turns on "Show the page to Requesters". The sidebar card and the tab are for staff only.

**Can my page read tickets through Tikki?**
No. The page token has no ticket, and the API answers `401`. Store what you need when a sidebar card or a tab sends it to your backend, with a ticket token.

**Can my page change the ticket with a message, without a backend?**
No. Writes go only through the REST API with the token. If a message could change the ticket, one script bug on your page could change any ticket the Agent can reach.

**Can I use my Application API key instead?**
An API key reaches only the tickets that the Application created for its own customers. The context token reaches the ticket the Agent has open, whoever created it.

**Do I get comments in the context?**
No. Call `GET /api/v1/tickets/{ref}/comments` with the token. The answer has the comments the Agent can see, internal ones included.

**Can one app show in the sidebar and as a tab?**
Yes. Set the Sidebar URL and the Tab URL. They can be two pages, or one page that reads `placement` from its query. Each frame gets its own token, for the origin of its own URL.

**Can I open a link or a popup?**
Yes. Popups and `target="_blank"` links work. The frame cannot navigate the Tikki tab itself. To open a ticket or another app page in Tikki, send `tikki:navigate`.
