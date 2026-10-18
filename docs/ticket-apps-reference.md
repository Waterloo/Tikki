# Ticket Apps reference

The exact values for a Ticket App: settings, placements, messages, the context, the tokens, the scopes and the manifest. To learn how to build an app step by step, read the [guide](ticket-apps.md) first.

## App settings

An Admin adds an app in **Ticket Apps**, with **Add from manifest** (see [Manifest](#manifest)) or with **Add app** and this form:

| Setting | Values | Notes |
|---|---|---|
| Name | Text | Shown as the card title or the tab name. Keep it short: "Orders". |
| Icon | A built-in icon and color, or an uploaded image | Shown on the card title, the tab and the admin list. See [Icons](#icons). |
| Sidebar URL | `https://...` or empty | A card in the ticket sidebar. |
| Tab URL | `https://...` or empty | A tab next to Conversation and Activity. |
| Page URL | `https://...` or empty | A page in the Apps menu of the main sidebar. |
| Show the page to Requesters | On or off | Default off: only Agents and Admins see the page. On: Requesters also see it. Only for the page: the sidebar card and the tab are always for staff only. Needs a page URL. |
| Show on | "All Ticket Types", or "Only these types" with a checklist | For example, check "Data request" and "Payment issue". "All Ticket Types" also covers types added later. |
| Access | `read`, `comment` or `update` | What your backend may do with the token. Default `read`. See [Scopes](#scopes). A lower access applies at once, also to tokens made before. A higher access applies to new tokens only. |
| On | On or off | Off hides the app and stops its tokens at once. |

Set at least one URL. A placement is on when its URL is set. For each URL:

- Its **origin** is the token audience for that placement. The URLs can be on different origins.
- It must use `https://`. `http://` works only for a loopback address (`localhost`, `127.0.0.1`, `[::1]`) on a development or test instance.
- It cannot be on Tikki's own origin.

Apps appear in the order of the admin list, in the ticket and in the Apps menu.

### Icons

- **Built-in:** the Lucide icons and colors of Ticket Types. Default: app window, neutral.
- **Image:** a light image and an optional dark image. PNG, WebP or SVG, 256 KB at most each. Square is best: Tikki shows it in a square box. Without a dark image, the light one shows in dark mode.

Tikki stores the files and serves them to signed-in Agents and Admins. It never loads an icon from your site, so your site cannot see who uses Tikki and when.

### Framing

Your page must allow Tikki to frame it. If you send a CSP header, include Tikki's origin:

```text
Content-Security-Policy: frame-ancestors https://tikki.example.com
```

Remove `X-Frame-Options: DENY` or `SAMEORIGIN` from that page, or the browser shows an empty frame.

## Placements

| | `sidebar` | `tab` | `page` |
|---|---|---|---|
| Where | A card in the ticket sidebar, below Requester | A tab after Conversation and Activity | `/apps/{id}`, from the Apps menu of the main sidebar. Outside any ticket |
| Who | Agents and Admins | Agents and Admins | Agents and Admins; also Requesters when "Show the page to Requesters" is on |
| Width | The sidebar width (about 280–360 px; full width on a phone) | The main column width | The main area (full width on a phone) |
| Height | Starts at 200 px. You set it with `tikki:resize`, 120–600 px | Fills the column | Fills the main area under the page header |
| Loads | When the ticket opens | The first time the Agent opens the tab, then it stays loaded | When the User opens the page |
| Context | [Ticket context](#the-context), [ticket token](#the-ticket-token) | Ticket context, ticket token | [Page context](#the-page-context), [page token](#the-page-token) |
| Good for | Short facts: plan, last order, account status | A full tool: order history, refund form | A tool across tickets: a timesheet, a report |

Tikki adds `placement=sidebar`, `placement=tab` or `placement=page` to the query of the URL. It keeps the rest of the query you wrote; a `placement` already in your URL is replaced. For example, `https://orders.you.com/tikki?view=compact` loads as `https://orders.you.com/tikki?view=compact&placement=sidebar`. The context has the same value in `app.placement`, and the token in `tikki_placement`. On your backend, use the checked token, not the query.

An app with a page shows the app's name as the page title, and your frame fills the main area under it. For anyone who may not see the page, Tikki shows "No app page here" and makes no token.

## Messages

All messages are plain objects with a `type`. Always pass Tikki's origin as the target origin, never `'*'`.

### From your app to Tikki

| `type` | Fields | Effect |
|---|---|---|
| `tikki:fetch-context` | — | Tikki answers with `tikki:context`. Use it at start-up and when your token is close to expiry. Send a first message within 10 s of load, or Tikki shows "The app did not answer". |
| `tikki:resize` | `height` (number, px) | Sidebar only. Tikki clamps it to 120–600. Ignored for tabs. |
| `tikki:refresh` | — | Tikki reloads the ticket. Send it after your backend changed the ticket. Ignored on a page. |
| `tikki:navigate` | `path` (string) | Tikki opens this Tikki path in the same tab, for example `/tickets/PAY-1048` or `/apps/4`. Works from every placement. |

Tikki ignores other types, and messages from any window other than your iframe.

`tikki:navigate` accepts only a path that starts with `/tickets/` or `/apps/`, with no scheme, no `//`, no backslash and no white space. Tikki resolves `..` first, so `/tickets/../sign-out` is ignored too. It ignores every other path without an answer. To open your own site, use a link with `target="_blank"`.

### From Tikki to your app

| `type` | Fields | When |
|---|---|---|
| `tikki:context` | `data`, `token`, `expires_at` | When the frame loads, after `tikki:fetch-context`, after the Agent changes the ticket on this page (Status, assignee, Fields, ...), and when the color mode changes. A change by another person does not send it. On a page, `data` is the [page context](#the-page-context). |

## The context

`data` in `tikki:context` for the `sidebar` and `tab` placements. The field names and shapes are the same as in the REST API (`GET /api/v1/tickets/{ref}`).

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

| Key | Notes |
|---|---|
| `app.placement` | `sidebar` or `tab`: the frame that gets this context. An app with both URLs has two frames, and each gets its own context and token. |
| `theme` | `light` or `dark`: the Agent's mode. |
| `requester.kind` | `user` (a person in your organization: `id`, `name`, `email`) or `contact` (a customer of an Application: `id`, `external_id`, `name`, `email`). Look up your customer with `external_id` when it is set. It is the id the Application gave Tikki. |
| `assignee`, `team` | Can be `null`. |
| `fields` | The values of the ticket's own Schema Version. Read labels from `schema_fields`. A Field without a value is missing from `fields`. |
| `version` | Changes only for a breaking change. New fields can appear at any time; ignore what you do not know. |

The context has **no comments, attachments or Participants**. Ask the API for comments with the token (see [Scopes](#scopes)).

## The page context

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

## Tokens

Both tokens are JSON Web Tokens, signed by Tikki. Each lives 5 minutes. `expires_at` in the message tells you when it ends. Ask again with `tikki:fetch-context` before that.

### The ticket token

The `sidebar` and `tab` placements get this token.

| Claim | Value |
|---|---|
| `iss` | `https://tikki.example.com/api/auth` |
| `aud` | The origin of the URL of this placement, for example `https://app.you.com` |
| `sub` | The Agent's User id (same as `agent.id`) |
| `tikki_app` | Your app id (same as `app.id`) |
| `tikki_placement` | `sidebar` or `tab` (same as `app.placement`) |
| `tikki_ticket` | The ticket ref, for example `PAY-1048` |
| `tikki_scope` | `read`, `comment` or `update`: the app's access when Tikki made the token |
| `iat`, `exp` | Issued at, expires (5 minutes later) |

### The page token

| Claim | Value |
|---|---|
| `iss` | `https://tikki.example.com/api/auth` |
| `aud` | The origin of the page URL |
| `sub` | The User id (same as `user.id`) |
| `tikki_app` | Your app id |
| `tikki_placement` | `page` |
| `tikki_role` | `admin`, `agent` or `requester`: the User's role when Tikki made the token |
| `iat`, `exp` | Issued at, expires (5 minutes later) |

**The page token proves who the User is, and nothing more.** It has no `tikki_ticket` and no `tikki_scope`. The Tikki REST API and `/mcp` answer `401` to it. The role is the role at the time Tikki made the token, so a role change applies within 5 minutes.

### Check a token

Use any JWT library that reads a JWKS. The keys are at `https://tikki.example.com/api/auth/jwks`.

- Always check `issuer`, `audience` and the expiry. The audience is your own origin, exactly.
- A token with another audience was made for another app, or for another placement of your app on another origin. Refuse it. If your sidebar and tab are on two origins, each backend checks its own origin.
- Always check `tikki_placement`. If your sidebar and your page are on one origin, both tokens have the same `aud`: a sidebar token has a ticket, a page token has none.
- Use the checked `sub`, `tikki_ticket` and `tikki_role`, not the values in the browser context, for any decision on your side.

## Scopes

The calls that a ticket token may make, for each access level. How the calls work, with examples: [Change the ticket](ticket-apps.md#change-the-ticket).

| Scope | Allowed calls |
|---|---|
| `read` | `GET /api/v1/tickets/{ref}` · `GET /api/v1/tickets/{ref}/comments` · `GET /api/v1/tickets/{ref}/activity` |
| `comment` | All of `read`, plus `POST /api/v1/tickets/{ref}/comments` |
| `update` | All of `comment`, plus `PATCH /api/v1/tickets/{ref}` (Status, Priority, assignee and Fields) |

A token never allows: lists or search, a type change, a Team move, a description edit, Participants, attachments, cancel, delete, revert, or any admin route. People do those in Tikki. These routes answer `403`, or `401` for a route that is only for the Tikki web app.

Tikki uses the lower of `tikki_scope` and the app's access now. So when an Admin lowers the access, the old tokens lose the higher rights at once.

`visibility` of a new comment is `internal` (only staff see it) or `public` (the requester sees it and is notified). The comments that `GET .../comments` returns are the comments the Agent can see, internal ones included.

## What people see

Every change by your app appears in the ticket's Activity as **"Sam Lee (via Orders)"**, and a comment shows the chip **"via Orders"** next to the Agent's name. If the app is deleted later, it shows "via a Ticket App". The audit log records the Agent and the app.

A change by your app makes the same webhook Event and notifications as a change in the web app. The Event has `channel: "app"`, and its `actor` names the app:

```json
{ "kind": "user", "id": "u_8f2c", "name": "Sam Lee", "channel": "app", "ticket_app": { "id": 4, "name": "Orders" } }
```

The webhook of an Application gets `{ "kind": "support" }` as the actor, without the Agent or the app.

## Manifest

One JSON file on your site that describes your app. An example and the flow: [Publish a manifest](ticket-apps.md#publish-a-manifest).

### Keys

| Key | Required | Value |
|---|---|---|
| `tikki_app` | Yes | The format version. Only `1` is known. Tikki refuses any other version. |
| `name` | Yes | Text, at most 40 characters. The card title, the tab name and the page title. |
| `description` | No | Text, at most 200 characters. The Admin sees it in the preview and in the list of apps. |
| `urls` | Yes | An object with `sidebar`, `tab` and `page`. Set at least one. Each URL follows the rules of [App settings](#app-settings). See [Placements](#placements). |
| `icons` | No | An object with `light` and an optional `dark`. Each is the URL of a PNG, WebP or SVG file, 256 KB at most. Without a dark icon, the light one shows in dark mode. Without `icons`, the built-in app icon shows. |
| `access` | No | `read`, `comment` or `update`: the access your app asks for. Default `read`. See [Scopes](#scopes). |

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

While the app has a manifest, the Admin cannot grant more than the manifest asks for, also not in the edit form.

### Updates

Tikki never checks for updates by itself, and nothing changes without the Admin. When the Admin selects **Check for updates** on the app:

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

## Security checklist

- [ ] Check `event.origin === TIKKI_ORIGIN` and `event.source === window.parent` on every message.
- [ ] Post only to `TIKKI_ORIGIN`, never `'*'`.
- [ ] Trust nothing from the browser context on your backend. Check the token: signature, `iss`, `aud` (your origin), `exp`, and `tikki_placement`.
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
| The frame is empty | The browser blocked the frame | Allow Tikki's origin in `frame-ancestors`, and remove `X-Frame-Options`. See [Framing](#framing). |
| Your card is a white box in dark mode | The frame's color scheme differs from Tikki's | Set `color-scheme` from `theme`. |
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
