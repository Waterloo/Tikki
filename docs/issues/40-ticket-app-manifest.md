# 40 · Add a Ticket App from its manifest

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md). Owner request, 2026-10-18. Design: [ADR 0005](../adr/0005-ticket-app-placements-pages-manifest.md).

## What to build

An app can describe itself in a JSON file. The Admin pastes one address, checks a preview, and approves. The manual form (issues 37–39) stays.

### The manifest

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

- `tikki_app` (required) is the format version; only `1` is known. `name` (required, at most 40 characters), `description` (optional, at most 200), `urls` (at least one), `icons` (optional, `dark` optional), `access` (optional: `read`, `comment` or `update`; default `read`).
- Relative URLs resolve against the manifest URL. Each URL follows the rules of issue 37.
- Unknown keys are ignored, so an app can add fields for newer versions. A wrong type in a known key is an error with the key named.

### Import

1. Admin: "Add from manifest", pastes the manifest URL (HTTPS; loopback HTTP only in development).
2. Tikki fetches it on the server with the safe fetch of `server/utils/cimd-fetch.ts` (no private or loopback addresses outside development, a timeout, at most 64 KB, JSON only, no redirects to another origin). It also fetches the icons the same way, with the limits of issue 38.
3. **Preview:** name, description, both icons on a light and a dark tile, each placement with its URL, and the access the app asks for.
4. The Admin chooses: Ticket Types ("Show on"), "Show the page to Requesters", and the access. **The access can be the requested level or lower, never higher.** Then "Add app".
5. Tikki saves the app with `manifest_url` and a hash of the manifest it approved. The icons are copied into R2 (issue 38); browsers never load them from the app's site.

### Updates

- **"Check for updates"** on the app: Tikki fetches the manifest again and shows what changed (name, description, URLs, icons, requested access).
- **Warnings:** a new origin in any URL, or a higher requested access, is shown as a warning. The Admin must confirm it.
- The Admin applies or ignores the update. **Nothing changes without the Admin.** No background updates.
- An update never raises the granted access by itself. If the app asks for more, the Admin raises it in the same step.

### Audit

`ticket_app_created` (with `manifest_url`), `ticket_app_changed` (`manifest_update`: the changed keys before and after). A failed fetch is not audited.

### Errors

Each failure gets a clear message: unreachable, too large, not JSON, unknown `tikki_app` version, missing `name` or `urls`, a bad URL (with the key), and a bad icon (with the reason). Nothing is saved.

## Acceptance criteria

- [x] Test: a valid manifest from the e2e app server gives a preview; "Add app" saves the URLs, the copied icons and `manifest_url`.
- [x] Test: the Admin cannot grant more access than the manifest requests (422).
- [x] Test: a manifest on a private address (outside development), over 64 KB, not JSON, with `tikki_app: 2`, or without `urls` is refused with a clear error, and nothing is saved.
- [x] Test: "Check for updates" with a changed manifest returns the changes; a new origin and a higher access are marked as warnings; nothing changes until "Apply".
- [x] Playwright: add from manifest, see the preview with both icons, approve, and see the app on a ticket.
- [x] The guide has a "Manifest" section with the format, the rules and the update flow.

### Evidence

- Preview and add: `test/worker/ticket-app-manifest.test.ts` "previews a valid manifest, and "Add app" saves …" (relative URLs resolved, icons as `data:` URLs, no write on preview; the app row has `manifest_url` and `manifest_hash`; the icon route serves the fetched bytes; audit `ticket_app_created` with `manifest_url`, then `ticket_app_changed` with the icon). The worker test uses a fake site (fetch mock); the e2e test uses the e2e app server (below).
- Access: same file, "refuses more access than the manifest requests (422), on add and on edit" (also a PATCH of a manifest app).
- Refusals: same file, "refuses a private, loopback or plain-http address without a request" (no fetch), "refuses a manifest over 64 KB, not JSON, of an unknown version, or without urls …", "names the key of a bad URL and gives the reason of a bad icon", "refuses an unreachable server, an error status, and a redirect to another origin". Each checks that the count of apps and of audit entries stays the same.
- Updates: same file, "returns the changes with warnings, and nothing changes until "Apply"" (the app and the audit log are unchanged after the check; apply needs `confirm_warnings`; a stale hash is 409), "raises the access only in the Admin's step …", "keeps an Admin's own edit …", "does not audit a failed fetch …", "is for Admins only".
- Playwright: `e2e/ticket-app-manifest.spec.ts`: add from the test app server's `/tikki-app.json`, both icon tiles load `data:` images, "Update" is off above the requested access, approve with Read, the sidebar card on a ticket gets its context; then "Check for updates" with a new origin and a higher access, "Apply update" is off until the warnings are confirmed, and the row shows "Update access" and "Tab". No browser request goes to the app's icon URLs.
- Guide: `docs/ticket-apps.md` "Manifest" (keys, rules, how Tikki reads it, errors, what the Admin approves, updates). The "Planned (issue 40)" note is removed.
- Reviewer (opus, `git diff integration...issue-40`): rule 14a (`Changes` list locator) fixed; rule 12 (icons copied after the app row) answered with the 201-with-`warnings` path; rule 13 (Application principal and the write routes) added to "is for Admins only"; the stale row in apply fixed (row read after the fetch); the SSRF name gaps fixed, with test cases. R2-before-row on apply is the issue 38 pattern, kept.
- Seen in a browser on the dev server (8840): the admin list with a manifest app, "Add from manifest" (preview, the error list for a bad manifest, the 409 reload), and "Check for updates" with a warning, at 375 px and desktop, light and dark. No horizontal scroll at 375 px.

## Not verified

- A real public HTTPS manifest. The tests use a fetch mock (worker) and a loopback server (e2e, development). The private-address rule works on the host name only: a public name that resolves to a private address is not caught (same limit as webhooks; Workers cannot pin the address).
- The 5-second timeout: no test waits for it.

## Decisions made here

- **Safe fetch.** `server/utils/cimd-fetch.ts` has an allow list and no private-address check, timeout or size limit; it is the transport of the OAuth plugin and stays unchanged. The private-address rule was in `webhooks.ts` (`endpointUrlProblem`). It moved to `server/utils/safe-fetch.ts` as `publicUrlProblem`; `endpointUrlProblem` calls it, with the same messages. `safeGet` adds GET, a 5 s timeout over headers and body, a byte limit (`readLimited`, which now also takes a `Response`), and redirects only on the same origin (at most 3). The reviewer found gaps in the moved rule, now closed for both callers: a trailing dot (`localhost.`), IPv6 hosts that start with `::` (IPv4-compatible, for example `[::127.0.0.1]`), NAT64 `64:ff9b::` and site-local `fec0::/10`. Loopback only in development, as for webhooks (the spec says so); app URLs keep the issue 37 rule (development or test).
- **Columns** (plain `ADD`, migration `0028_issue_40_ticket_app_manifest.sql`): `manifest_url`, `manifest_hash`, `manifest` (JSON: the approved manifest, normalized). The approved manifest is the base for "Check for updates"; the hash alone cannot show what changed, and the description is not on the app.
- **Hash** = SHA-256 of the normalized manifest (URLs resolved, defaults set), with the SHA-256 of each icon's bytes in it. So white space does not count as a change, and new icon bytes at the same URL do.
- **Preview, then approve by hash.** `POST /api/v1/admin/ticket-apps/manifest/preview` `{ manifest_url }` saves nothing. `POST /api/v1/admin/ticket-apps/manifest` `{ manifest_url, hash, access?, ticket_type_ids?, page_for_requesters?, enabled? }` fetches again and answers 409 `MANIFEST_CHANGED` when the hash differs, so the Admin approves exactly what they saw. The client never sends manifest content.
- **Icons in the preview** are `data:` URLs from Tikki. On add, the app row is made first (one batch with `ticket_app_created`), then the icons go to R2 and the row update has its own `ticket_app_changed` (R2 first, then the row, as in issue 38). The R2 key needs the id. If the icon copy fails after the app exists, the answer is still 201, with `warnings` (the dialog shows a toast): an error answer would make the Admin add the app twice.
- **Errors** are 422 `VALIDATION_FAILED` with `details`: `manifest_url` for fetch, size, JSON and object problems; the manifest key otherwise (`tikki_app`, `name`, `urls`, `urls.tab`, `icons.dark`, `access`). `tikki_app` is checked first: other keys of an unknown version can mean something else. Null counts as absent for optional keys. Content type is not checked: static hosts differ; the body must be a JSON object.
- **Updates.** `POST …/{id}/manifest/check` (fetches, compares with the approved manifest, changes nothing) and `POST …/{id}/manifest/apply` `{ hash, access?, confirm_warnings? }`. Only the keys that changed in the manifest change on the app, so an Admin's own edit of another key stays. The row is read after the fetch (which can take seconds), so an edit during the fetch is not lost. 422 `confirm_warnings` when there is a warning and no confirmation.
- **Warnings**: a placement URL on an origin that no placement URL of the approved manifest had, and a higher requested access. Icon URLs give no warning: Tikki copies the icons, so their origin never gets a token or a browser request.
- **Access.** Granted ≤ requested always: on add, on apply, and on a PATCH of a manifest app (422 key `access`). Apply without `access` keeps the granted access, lowered to the new request when that is lower.
- **Apply refuses** a change that leaves no URL, or removes the page while "Show the page to Requesters" is on (the rules of issues 37 and 39), and does not reset them silently.
- **Audit**: `ticket_app_created` has `manifest_url` and `manifest_hash` in `after`. An applied update is one `ticket_app_changed` with the changed app keys and `manifest_update` (the changed manifest keys) in `before` and `after`. A preview, a check and a failed fetch write nothing.
- **UI**: "Add from manifest" next to "Add app" (`TicketAppManifestDialog.vue`), "Check for updates" on a manifest app's row (`TicketAppUpdateDialog.vue`), one preview (`TicketAppManifestPreview.vue`). Access choices above the request are off (`accessItems` in `app/utils/ticket-app-access.ts`, also in the edit form). After a 409 the dialog loads the new preview and keeps the Admin's choices.

## Notes for later issues

- `examples/time-tracking` ("Then"): serve `/tikki-app.json` with relative URLs and icons; the e2e app server (`e2e/ticket-app-server.mjs`, `?key=` and `PUT`) shows the shape.
- A new caller that fetches a URL from an Admin uses `safeGet` in `safe-fetch.ts`. Do not copy the private-address rule.
- `manifest` on `ticket_app` is the approved manifest, not the current one. A later "re-import" must update `manifest_hash` and `manifest` in the same batch as the app.

## Glossary terms to add

- **Manifest**: a JSON file (`tikki-app.json`) in which a Ticket App describes itself: name, description, placement URLs, icons and the access it asks for. The Admin approves it; the granted access is never above the requested access.


## Blocked by

- [38 · Ticket App icons](38-ticket-app-icons.md)
- [39 · App pages](39-app-pages.md)

## Then

Update `examples/time-tracking`: separate sidebar, tab and timesheet pages, light and dark icons, and `/tikki-app.json`. Timesheet rule: Admins see every person's time; Agents see their own (owner default, 2026-10-18).
