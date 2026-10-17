# 25 · SSO sign-in: Google, Microsoft, generic OIDC

**Type:** HITL (OAuth client registration with Google and Microsoft)
**Labels:** —

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Users can sign in with their work account instead of a code, and instances without email (the `free` profile) can sign in at all.

- Better-Auth providers: Google, Microsoft, and one generic OIDC provider. Each is on only when its settings are present.
- The allow list (`ALLOWED_EMAIL_DOMAINS`) is required when Google or Microsoft is on. It is optional for a generic OIDC provider (the organization's own identity provider).
- The Worker refuses to start when no sign-in method can work: the transport is `none` and no SSO provider is configured.
- An SSO sign-in and an email-code sign-in with the same email are the same User.
- The sign-in page shows only the methods that are on. Settings shows them as read-only.
- SSO works inside the Claude OAuth popup.

## Acceptance criteria

- [ ] Test: with Google on and no allow list, the Worker fails at startup with a clear error.
- [ ] Test: with transport `none` and no SSO provider, the Worker fails at startup with a clear error.
- [ ] Test: a Google account outside the allow list is refused.
- [ ] Test: an email-code User who later signs in with Google is the same User, with the same role and tickets.
- [ ] Manual check: Google sign-in works on staging, in the web app and in the Claude connector popup.

## Blocked by

- [01 · Walking skeleton](01-walking-skeleton.md)
