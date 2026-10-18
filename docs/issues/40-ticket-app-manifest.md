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

- [ ] Test: a valid manifest from the e2e app server gives a preview; "Add app" saves the URLs, the copied icons and `manifest_url`.
- [ ] Test: the Admin cannot grant more access than the manifest requests (422).
- [ ] Test: a manifest on a private address (outside development), over 64 KB, not JSON, with `tikki_app: 2`, or without `urls` is refused with a clear error, and nothing is saved.
- [ ] Test: "Check for updates" with a changed manifest returns the changes; a new origin and a higher access are marked as warnings; nothing changes until "Apply".
- [ ] Playwright: add from manifest, see the preview with both icons, approve, and see the app on a ticket.
- [ ] The guide has a "Manifest" section with the format, the rules and the update flow.

## Blocked by

- [38 · Ticket App icons](38-ticket-app-icons.md)
- [39 · App pages](39-app-pages.md)

## Then

Update `examples/time-tracking`: separate sidebar, tab and timesheet pages, light and dark icons, and `/tikki-app.json`. Timesheet rule: Admins see every person's time; Agents see their own (owner default, 2026-10-18).
