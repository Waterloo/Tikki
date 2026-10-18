# Time tracking: an example Ticket App

Agents log the time they spend on a ticket, in a card in the ticket sidebar. The card shows the total and every entry. An Agent can add an internal note to the ticket with each entry ("Logged 1h 30m: Reproduced the export bug").

It is a separate Cloudflare Worker with its own D1 database. It follows the [Ticket App guide](../../docs/ticket-apps.md).

## How it works

- The page asks Tikki for the context and gets a context token.
- Every call to `/api/entries` sends the token. The Worker checks it against Tikki's JWKS. The ticket and the Agent come only from the checked token, never from the request body.
- An entry stores the ticket reference, the Agent's User id, the minutes and the note. The Agent's name is display text from the context; it is never used for a decision.
- Only the Agent who logged an entry can delete it. A delete waits 5 seconds with Undo, so Undo needs no server call.
- The page uses Tikki's colors, font and radius (`src/page.js`), follows Tikki's light or dark mode, and has quick buttons for 15m, 30m, 1h and 2h.
- "Add an internal note to the ticket" calls `POST /api/v1/tickets/{ref}/comments` on Tikki with the same token. This needs the app's access to be **Comment** or **Update**. With **Read**, the box is off.

Time formats: `45`, `45m`, `1h`, `1h 30m`, `1.5h`, `1:30`. One entry is at most 24 hours.

## Run it locally

From the repository root (it uses the root `node_modules` for `jose`), with Tikki running on `http://localhost:8787`:

```bash
pnpm exec wrangler d1 migrations apply TIME --local -c examples/time-tracking/wrangler.jsonc
```

```bash
pnpm exec wrangler dev -c examples/time-tracking/wrangler.jsonc --port 5174
```

If Tikki runs on another port, add `--var TIKKI_ORIGIN:http://localhost:<port>`.

In Tikki, open **Ticket Apps** and add:

| Setting | Value |
|---|---|
| Name | Time tracking |
| URL | `http://localhost:5174/` |
| Position | Sidebar |
| Access | Comment |

Open any ticket as an Agent or Admin.

## Deploy it

1. Create the database, and put its id in `wrangler.jsonc`:

   ```bash
   pnpm exec wrangler d1 create tikki-time
   ```

2. Apply the migration:

   ```bash
   pnpm exec wrangler d1 migrations apply TIME --remote -c examples/time-tracking/wrangler.jsonc
   ```

3. Set `TIKKI_ORIGIN` in `wrangler.jsonc` to your Tikki address, for example `https://tikki.example.com`, then deploy:

   ```bash
   pnpm exec wrangler deploy -c examples/time-tracking/wrangler.jsonc
   ```

4. Add the Worker's HTTPS address as a Ticket App. An HTTPS Tikki cannot frame an `http://` page.

## Not included

Reports across tickets, editing an entry, and timers. Add a report page with its own sign-in if you need totals per Agent or per month: the context token is only valid inside the ticket.
