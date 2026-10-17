# 24 · Production baseline and self-hosting

**Type:** HITL (production Cloudflare resources, GitHub secrets, Sentry project)
**Labels:** —

## Parent

[docs/PRD.md](../PRD.md)

## What to build

The owner runs production safely, and any team can install its own copy.

- A `production` environment with its own D1, R2, and secrets. Deploys to production only from GitHub Actions on merge. No manual production deploy.
- Forward-only migrations run in CI before each deploy.
- Backups: D1 Time Travel, plus a nightly export to R2 by a Cron Trigger.
- Sentry for errors, on only when a DSN is set.
- A "Deploy to Cloudflare" button, and self-host docs: environment variables, Deploy Profiles, sign-in setup, the allow list, connecting Claude, upgrading.
- The MIT license file.

## Acceptance criteria

- [ ] A merge to `main` deploys staging, and a release tag deploys production, both through CI.
- [ ] The nightly export creates a file in R2, and a documented restore from it works on staging.
- [ ] Without a Sentry DSN, the app runs and sends nothing.
- [ ] A person who follows only the docs and the Deploy button on a fresh Cloudflare account gets to the first ticket in less than 10 minutes (timed once).
- [ ] The repository has an MIT LICENSE file.

## Blocked by

- [01 · Walking skeleton](01-walking-skeleton.md)
