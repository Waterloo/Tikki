# Build a Ticket App

A **Ticket App** is your own web page inside Tikki. Agents use it next to the ticket they work on, and a full page of it can open from the main sidebar. Tikki tells your page who looks at it (and in a ticket, which ticket is open), with a signed token that proves it. You need no SDK: a normal web page with about 20 lines of JavaScript.

## Where your app shows

An app has up to three placements: a sidebar card and a tab in each ticket, and a page of its own. Each placement has its own URL, so a sidebar card can be a small page that loads fast, and the tab can be a full tool on another host. One app can use one, two or all three. Sizes and loading: [Placements](ticket-apps-reference.md#placements).

### In a ticket

![A Tikki ticket page. The app shows as a card in the ticket sidebar, below Requester, and as a tab next to Conversation and Activity.](assets/ticket-apps-placements.svg)

1. **Sidebar card:** a card in the ticket sidebar, below Requester. For short facts: the plan, the last order, the account status.
2. **Tab:** a tab after Conversation and Activity. For a full tool: an order history, a refund form.

The sidebar card and the tab are for Agents and Admins.

### As a page

![A Tikki app page. The main sidebar has an Apps menu with an entry for the app. The page shows the app's name as its title, and the app's frame, a timesheet, fills the main area.](assets/ticket-apps-page.svg)

A page at `/apps/{id}`, outside any ticket, with an entry in the **Apps** menu of the main sidebar. For a tool across tickets: a timesheet, a report. A page is for Agents and Admins, and also for Requesters when the Admin allows it. See [Build a full page](#build-a-full-page).

Typical apps:

- An orders panel that shows the customer's last orders next to a payment ticket.
- A user lookup that shows the account plan, sign-up date and feature flags.
- A refund tool that issues a refund and adds "Refund issued" to the ticket.
- A timesheet page with the time of every ticket, by ticket or by person.

## Try it in 2 minutes

The time tracking example is a real app with all three placements: a card to log time, a tab with the full log, and a timesheet page. It runs as one Cloudflare Worker with its own D1 database.

1. Run Tikki locally (see the README). It listens on `http://localhost:8787`.
2. From the repository root, set up and start the example:

   ```bash
   pnpm exec wrangler d1 migrations apply TIME --local -c examples/time-tracking/wrangler.jsonc
   ```

   ```bash
   pnpm exec wrangler dev -c examples/time-tracking/wrangler.jsonc --port 5174
   ```

3. In Tikki, sign in as `admin@example.com`, open **Ticket Apps**, select **Add from manifest**, and paste `http://localhost:5174/tikki-app.json`. The preview shows the name, both icons, the three URLs and the access the app asks for (**Comment**). Approve it.
4. Open any ticket: the card is in the sidebar, and **Time tracking** is a tab. Select **15m**, then **Log time**. Then open **Time tracking** in the Apps menu: the timesheet shows your time.

How the example works, and how to add it by hand: [examples/time-tracking](../examples/time-tracking/README.md).

## How it works

![The Tikki ticket page loads your app in an iframe. 1: Tikki loads the URL of the placement. 2: your app sends tikki:fetch-context and gets tikki:context and the token. 3: your backend checks the token with Tikki's public keys. 4: optional, your backend calls the Tikki REST API with the token.](assets/ticket-apps-flow.svg)

1. The Agent opens a ticket. Tikki loads the URL of each placement in its own iframe.
2. Your page asks for the context. Tikki answers with the ticket, the requester, the Agent, and a **context token** (in a ticket, the **ticket token**).
3. Your page sends the token to your backend. Your backend checks the token's signature against Tikki's public keys. Now it knows that this Agent has this ticket open.
4. If the Admin gave your app write access, your backend can add a comment or change the ticket through the Tikki REST API, with the same token.

> [!WARNING]
> Do not trust the context in the browser alone: any page can post a message. Your backend must trust only the **checked token**.

## Build your first app

### The page

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

Your page must let Tikki frame it: allow Tikki's origin in `frame-ancestors`. See [Framing](ticket-apps-reference.md#framing).

### Add it in Tikki

An Admin opens **Ticket Apps**. There are two ways to add an app:

- **Add from manifest:** the Admin pastes the address of your manifest. Tikki reads the name, the URLs, the icons and the access from it. The Admin chooses the rest. See [Publish a manifest](#publish-a-manifest).
- **Add app:** the Admin fills in a form: the name, the icon, one URL for each placement, the Ticket Types to show it on, and the access. See [App settings](ticket-apps-reference.md#app-settings).

The rules for each URL (https, loopback on a development instance): [App settings](ticket-apps-reference.md#app-settings).

### Check the token on your backend

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
    placement: payload.tikki_placement,
    scope: payload.tikki_scope,
  }
}
```

`jwtVerify` checks the signature, the issuer, the audience and the expiry. Then use the checked `sub` and `tikki_ticket` for each decision on your side. For example, show refunds only for the order in the checked ticket. All claims and rules: [Tokens](ticket-apps-reference.md#tokens).

The token can be your app's sign-in. Browsers block third-party cookies in iframes, so a cookie session inside the frame often fails. Send the token with each request, or swap it once for your own short session.

### Look right in every placement

- **Match light and dark mode.** `theme` in the context is `light` or `dark`. Set `color-scheme` on your page to match (`:root { color-scheme: dark }` in dark mode). The browser paints a frame opaque when its color scheme differs from the page around it, so without it your card shows as a white box in dark mode.
- **Design for narrow widths.** The sidebar card is narrow, and on a phone every placement is full width. Sizes: [Placements](ticket-apps-reference.md#placements).

## Show something in a ticket

The sidebar card and the tab get the **ticket context**: the ticket, the requester and the Agent, with the same field names as the REST API. The full shape: [The context](ticket-apps-reference.md#the-context).

- **Find your customer.** For a ticket from an Application, `requester.external_id` is the id that the Application gave Tikki. Use it to look up the customer in your system.
- **Fit the card.** Send `tikki:resize` with the height of your content. The limits: [Messages](ticket-apps-reference.md#messages).
- **Stay current.** Tikki sends a new `tikki:context` after the Agent changes the ticket on this page, and when the color mode changes. Re-render from the new data.
- **Keep a fresh token.** The token is short-lived: send `tikki:fetch-context` again before `expires_at`.

## Change the ticket

![Three nested access levels. read: get the ticket, its comments and its Activity. comment: also add a comment. update: also change the Status, Priority, assignee and Fields. Never with a token: lists, search, a type change, a Team move, a description edit, Participants, attachments, cancel, reopen, delete, revert, admin routes.](assets/ticket-apps-access.svg)

The Admin gives your app an access level: `read`, `comment` or `update`. Your backend calls the Tikki REST API with the ticket token. With `read` it gets the ticket, its comments and its Activity. With `comment` and `update` it can also write.

```text
Authorization: Bearer <context token>
```

The API treats the call as **the Agent who has the ticket open**, through your app. Three limits apply:

- **One ticket.** Only the ticket in `tikki_ticket`. Any other ticket answers `404`.
- **Your access level.** Only the actions of your app's access level. Others answer `403`.
- **The Agent's rights.** If the Agent cannot do it in Tikki, your app cannot either.

Call the API only from your backend. The API sends no CORS headers for this, so the browser cannot use the token from any page. Each route of each level: [Scopes](ticket-apps-reference.md#scopes).

Add an internal note (access level `comment`):

```bash
curl -X POST "https://tikki.example.com/api/v1/tickets/PAY-1048/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Refund of 49.00 issued for order 5521.", "visibility": "internal"}'
```

Resolve the ticket and set a Field (access level `update`):

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

The Activity shows the change as "Sam Lee (via Orders)". Webhooks and notifications go out as for a change in the web app. See [What people see](ticket-apps-reference.md#what-people-see).

## Build a full page

An app with a page URL gets a page at `/apps/{id}` in Tikki, with an entry in the **Apps** menu of the main sidebar. Who sees it: see [Where your app shows](#where-your-app-shows).

A page is outside any ticket. It gets the **page context**, with `user` and no ticket, and the **page token**, which proves only who the User is. The REST API and `/mcp` refuse the page token. The shapes and the claims: [The page context](ticket-apps-reference.md#the-page-context), [The page token](ticket-apps-reference.md#the-page-token).

Your backend checks the page token as in [Check the token on your backend](#check-the-token-on-your-backend), with your page's origin as the audience. Then:

- **Use `sub` and `tikki_role` for your own rules.** For example, a timesheet shows an Agent their own hours and an Admin the hours of everyone.
- **Store the ticket data you need.** A page cannot read tickets with its token. For example, the timesheet saves the ticket title when a sidebar card logs time.
- **Check `tikki_placement`**, so a page token and a sidebar token from one origin cannot be mixed up. See [Check a token](ticket-apps-reference.md#check-a-token).
- **Open a ticket from your page** with `tikki:navigate`. Tikki opens it in the same tab. It works from every placement, for Tikki paths only: see [Messages](ticket-apps-reference.md#messages).

  ```js
  window.parent.postMessage({ type: 'tikki:navigate', path: '/tickets/PAY-1048' }, TIKKI_ORIGIN)
  ```

## Which credential to use

![A field of tickets. The ticket token reaches the one open ticket. The page token reaches no ticket. An API key with Own tickets reaches the tickets its Application created. An API key with All tickets reaches every ticket that is not deleted, Restricted tickets only when the Admin includes them.](assets/ticket-apps-reach.svg)

1. **Ticket token** (sidebar card, tab): the one ticket the Agent has open, whoever created it, with the Agent's view and your app's access level.
2. **Page token:** no ticket. It proves who the User is.
3. **API key of an Application, Own tickets** (the default): only the tickets that the Application created.
4. **API key, All tickets:** every ticket that is not deleted. Restricted tickets only when the Admin includes them.

Use an API key for work that is not about the ticket the Agent has open, for example a timesheet that shows live titles and Statuses. The Admin sets **Read tickets** (and **Update tickets**, **Add comments**) to **All tickets** on the Application's page, for each permission on its own. An API key never gets staff data: no assignee, no Team, no Internal Comments, and people show as `support`. The [API reference](/docs/api) lists what each scope reaches.

## Publish a manifest

![The manifest flow. 1: you publish tikki-app.json. 2: the Admin pastes its address, and Tikki fetches it on its server and shows a preview. 3: the Admin grants the access, the level asked for or lower, and Tikki copies the icons and saves the app. 4: later, only when the Admin selects Check for updates, Tikki fetches it again, and the Admin applies or ignores the update.](assets/ticket-apps-manifest.svg)

1. **You publish** one JSON file on your site, for example at `https://time.example.com/tikki-app.json`: the name, the URLs, the icons and the access your app asks for.
2. **The Admin pastes its address** in **Ticket Apps → Add from manifest**. Tikki fetches the manifest and the icons on its own server, never in the Admin's browser, and shows a preview.
3. **The Admin grants** the access (never more than the app asks for) and the other settings. Tikki copies the icons into its own storage and saves the app.
4. **To change your app, change the manifest.** Nothing changes until the Admin selects **Check for updates** and applies the update.

The manifest asks; the Admin grants.

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

The time tracking example serves its manifest at `/tikki-app.json` with relative URLs, so it works on any address. Each key, the fetch limits, each error, what the Admin approves and the update rules: [Manifest](ticket-apps-reference.md#manifest).

## Test locally

1. Run Tikki locally, as in [Try it in 2 minutes](#try-it-in-2-minutes).
2. Serve your app on another port, for example `npx serve -p 5173`.
3. In Tikki, open Ticket Apps and add `http://localhost:5173` as the Sidebar URL, the Tab URL, the Page URL, or more than one (allowed only on a development or test instance).
4. Open any ticket as the Admin (`admin@example.com`). Your app shows in the sidebar, as a tab, or both. A page shows in the Apps menu of the main sidebar.
5. In your app, use `TIKKI_ORIGIN = 'http://localhost:8787'` and audience `http://localhost:5173`.
6. To test your manifest, serve it from the same server, for example `http://localhost:5173/tikki-app.json`, and use **Add from manifest**. On a development instance, Tikki can fetch it from a loopback address.

A minimal app with a backend token check is in [`examples/ticket-app/server.mjs`](../examples/ticket-app/server.mjs). Run it from the repository root:

```bash
node examples/ticket-app/server.mjs
```

It listens on `http://localhost:5173`. Set `TIKKI` when Tikki is not on `http://localhost:8787`. The card shows the context, and "Checked by the backend" shows the claims of the checked token.

If something does not work, see [Errors and edge cases](ticket-apps-reference.md#errors-and-edge-cases).

## FAQ

**Can I show my app to the customer (the requester)?**
Only a page, and only to a Requester in your organization (a User, not a Contact of an Application). See [Where your app shows](#where-your-app-shows).

**Can my page change the ticket with a message, without a backend?**
No. Writes go only through the REST API with the token. If a message could change the ticket, one script bug on your page could change any ticket the Agent can reach.

**Can one app show in the sidebar and as a tab?**
Yes. Set the Sidebar URL and the Tab URL. They can be two pages, or one page that reads `placement` from its query. Each frame gets its own token, for the origin of its own URL.

**Can I open a link or a popup?**
Yes. Popups and `target="_blank"` links work. The frame cannot navigate the Tikki tab itself. To open a ticket or another app page in Tikki, send `tikki:navigate`.
