# 21 · Settings, branding, and the first-run screen

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Admins brand the instance and see its configuration, and a new install shows its value at once. Screens: "Settings" and "First run" on the design canvas.

- Settings: organization name, subtitle, logo (PNG only, 1 MB maximum; SVG refused because it can contain script; fallback is the first letter of the name).
- Ticket numbers section: explanation only. Prefixes are set on each Ticket Type.
- Deployment section, read-only: address, connector URL with copy, sign-in methods and allow list, Deploy Profile, email sender.
- First-run screen for the first Admin: connector URL with copy, a suggested first message for Claude, "waiting for your first ticket", the example types, allowed domains, and a link to create an API key.

## Acceptance criteria

- [ ] REST test: an SVG or a file above 1 MB is refused as a logo.
- [ ] REST test: only Admins can change settings.
- [ ] The first Admin sees the first-run screen until the first ticket exists, and the normal list after that.
- [ ] Playwright flow: an Admin changes the name, and the sidebar shows it.

## Blocked by

- [03 · Ticket Types with Fields](03-ticket-types-with-fields.md)
