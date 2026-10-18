# Time tracking: an example Ticket App

Agents log the time they spend on a ticket. Admins and Agents see the time across tickets in a timesheet. One Cloudflare Worker with its own D1 database serves three views, one for each [placement](../../docs/ticket-apps.md#placements):

| URL | Placement | What it shows |
|---|---|---|
| `/sidebar` (also `/`) | Sidebar | A small card: the total, your time, a quick form and the last 5 entries. |
| `/tab` | Tab | The full log of the ticket: every entry by day, the total for each person, and a larger form. |
| `/timesheet` | Page | Time across tickets for a date range (This week, Last week, This month, Custom), by ticket or by person, with CSV export. |

It follows the [Ticket App guide](../../docs/ticket-apps.md).

## How it works

- Each view asks Tikki for the context and gets a token. Every API call sends the token. The Worker checks it against Tikki's JWKS, with the request origin as the audience.
- All three views are on one origin, so all tokens have the same audience. The Worker checks `tikki_placement` too: `/api/entries` accepts only a sidebar or tab token with `tikki_ticket`; `/api/timesheet` accepts only a page token.
- The ticket, the User and the role come only from the checked token, never from the request body.
- An entry stores the ticket reference, the Agent's User id, the minutes and the note. It also stores display text from the context: the Agent's name, the ticket title and the Ticket Type name. A page token cannot read tickets from Tikki, so the timesheet shows this saved text. Each new entry updates the title and type of the older entries of that ticket. This text is never used for a decision.
- Only the Agent who logged an entry can delete it. A delete waits 5 seconds with Undo, so Undo needs no server call.
- **Timesheet rule:** an Admin sees the time of every person. An Agent sees only their own time. Anyone else (a Requester, when the page is shown to Requesters) gets `403`. The role is `tikki_role` from the page token.
- The ticket reference in the timesheet sends `tikki:navigate` to `/tickets/{ref}`, so the ticket opens in the same Tikki tab.
- CSV export: the frame sandbox has no `allow-downloads`, so the page posts a form to `/api/timesheet.csv` in a new tab. The token goes in the form body, not in the URL. The file has the entries of the range, with dates in the browser's time zone.
- The views use Tikki's colors, font and radius (`src/ui.js`), follow Tikki's light or dark mode, and work from 375 px wide. Quick buttons for 15m, 30m, 1h and 2h.
- The "Note on ticket" switch calls `POST /api/v1/tickets/{ref}/comments` on Tikki with the same token. This needs the app's access to be **Comment** or **Update**. With **Read**, the switch is off.
- Icons for light and dark mode are in `icons/`. The Worker also serves them at `/icon-light.svg` and `/icon-dark.svg`.

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
| Icon | Upload image: `icons/icon-light.svg` as the light image, `icons/icon-dark.svg` as the dark image. Or a built-in icon. |
| Sidebar URL | `http://localhost:5174/sidebar` |
| Tab URL | `http://localhost:5174/tab` |
| Page URL | `http://localhost:5174/timesheet` |
| Show the page to Requesters | Off |
| Access | Comment |

Open any ticket as an Agent or Admin for the card and the tab. Open **Time tracking** in the Apps menu for the timesheet.

## Deploy it

1. Create the database, and put its id in `wrangler.jsonc`:

   ```bash
   pnpm exec wrangler d1 create tikki-time
   ```

2. Apply the migrations:

   ```bash
   pnpm exec wrangler d1 migrations apply TIME --remote -c examples/time-tracking/wrangler.jsonc
   ```

3. Set `TIKKI_ORIGIN` in `wrangler.jsonc` to your Tikki address, for example `https://tikki.example.com`, then deploy:

   ```bash
   pnpm exec wrangler deploy -c examples/time-tracking/wrangler.jsonc
   ```

4. Add the Worker's HTTPS URLs to a Ticket App: `/sidebar`, `/tab` and `/timesheet`, as in the table above. An HTTPS Tikki cannot frame an `http://` page.

A deployed copy runs at `https://time.jithinsha.in/` for `https://tikki.jithinsha.in` (`env.production` in `wrangler.jsonc`):

```bash
pnpm exec wrangler deploy --env production -c examples/time-tracking/wrangler.jsonc
```

## Upgrade from the one-view version

1. Apply the migrations again. `0002_ticket_details.sql` adds the ticket title and the Ticket Type name. Old entries get empty text; the timesheet shows their ticket reference.
2. Deploy.
3. In the Ticket App, add the Tab URL and the Page URL. The old Sidebar URL `/` keeps working.

## Not included

Editing an entry, timers, and a filter by person or by ticket in the timesheet.
