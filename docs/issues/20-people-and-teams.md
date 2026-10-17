# 20 · People: invites, roles, deactivation, Teams

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

Admins manage who can sign in and who owns what. The screen follows "Teams and users" on the design canvas.

- Users: change role, deactivate, reactivate. A deactivated User cannot sign in, and their sessions and MCP tokens stop working. Users are never deleted.
- Invites for individual emails outside the allow list. An invited email can sign in once invited.
- The sign-in section shows the allow list and sign-in methods as read-only.
- Teams: create, rename, add and remove Agents. An Agent can be in more than one Team. A Team that owns Ticket Types cannot be removed.

## Acceptance criteria

- [x] REST test: a deactivated User's session and MCP token are refused at once.
  Evidence: `test/worker/people.test.ts`, "stops the session, the MCP token and the refresh token at once, and blocks sign-in": after the Admin deactivates a User, the session answers 401, the unexpired MCP access token answers 401, the refresh token answers `invalid_grant`, and both a code request and a sign-in answer 403 `ACCOUNT_DEACTIVATED`. "refuses a valid MCP access token when only the flag is set" sets `deactivated_at` directly and shows that the per-call User check in `server/utils/mcp.ts` stops a JWT that has not expired (ADR 0003).
- [x] REST test: an invited email from another domain can sign in. A not-invited one cannot.
  Evidence: `test/worker/people.test.ts`, "lets an invited email from another domain sign in, and refuses one that is not invited" (403 before the invite, sign-in works after it and again later, another address on the same domain is refused), "refuses an expired invite until it is sent again, and a revoked invite", and "refuses a list with an address that needs no invite, has an account, is invited, or is not an email".
- [x] REST test: removing a Team that owns a type is refused.
  Evidence: `test/worker/people.test.ts`, "refuses to remove a Team that owns a Ticket Type, and removes one that owns none" (409 `TEAM_OWNS_TYPES`, "Support owns 4 Ticket Types. Move them to another Team first.").
- [x] REST test: only Admins can change roles.
  Evidence: `test/worker/people.test.ts`, "lets only Admins change roles, and every other People route is Admin only" (Agent and Requester get 403, no session gets 401, the role does not change; the Admin succeeds). Also "keeps one active Admin".
- [x] The audit log records each role change, invite, and deactivation.
  Evidence: `test/worker/people.test.ts`, "writes an audit entry with Principal and channel for each People change": `role_changed` (old and new role), `user_deactivated`, `user_reactivated`, `user_invited`, `invite_resent`, and the Team entries (`team_created`, `team_renamed`, `team_member_added`, `team_member_removed`, `team_removed`) each have the Admin as Principal and channel `web`. "keeps one active Admin" shows that a refused demotion writes no entry. The entries use `adminAuditEntry` (`server/utils/audit.ts`) in the same `db.batch` as the change.

Other checks:
- `e2e/people.spec.ts` (Playwright): an Admin opens "Teams and users" from the sidebar, invites an address outside the domain (row shows Invited), sees the refusal for a domain address, creates a Team, makes another User an Agent, adds the User to the Team, deactivates the User, and the other User's page returns to sign-in on reload. A Requester has no link and `/people` sends them to My tickets. At 375 px there is no horizontal scroll.
- Teams: `test/worker/people.test.ts` also covers create, rename, a duplicate name (409), an Agent in two Teams, a Requester refused as a member (409 `NOT_AN_AGENT`), and removal of memberships when a User becomes a Requester or is deactivated.
- Seen in the browser against `wrangler dev` (port 8806) on 2026-10-18: the Admin view in dark mode, at about 800 px and at 1440 px, matches the canvas (sign-in strip, Users table, Teams cards, the "One team is enough for now" card). Not seen in the browser: light mode, the invite and Team dialogs (Playwright drives them), the loading skeleton and the error state.

## Not verified

- Light mode and the loading and error states of the People screen were not looked at.
- The invite email goes through the Cloudflare mail transport only in production; tests use the capture transport.
- A real Claude connector was not used. The MCP refusal is tested with the same OAuth flow through REST.

## Decisions made here

- **Deactivation** sets `user.deactivated_at` (a Better-Auth additional field, so `auth:generate` keeps it). In one `db.batch` it also deletes the User's sessions, OAuth access and refresh tokens, and Team memberships. New sessions are refused in the Better-Auth `session.create.before` hook (every sign-in method ends there), and the code request and sign-in hooks answer a clear 403 first. Reactivation clears the flag only: the User signs in and connects Claude again, and an Admin adds them to Teams again.
- **MCP**: the access token is a JWT (ADR 0003), so `handleMcpRequest` reads `deactivated_at` in the User query it already runs for the role. No extra query.
- **An Admin cannot deactivate themself** (policy: `assertCanDeactivate`, 403). **The last active Admin cannot lose the role**: the check is inside the UPDATE statement, so two Admins who demote each other at once cannot both succeed (409 `LAST_ADMIN`). An Admin can demote themself when another active Admin exists. The `ADMIN_EMAIL` bootstrap and the sign-up role logic are unchanged.
- **Invites** live in the `invite` table: email (lower case), who invited, created, expires, accepted. Only emails outside the allowed domains can be invited (an in-domain, existing, or already invited address is refused, and one bad address refuses the whole list). The invite has no role: the User starts as Requester (3.14) and an Admin promotes. An invite **expires after 30 days** if nobody signs in; Resend sends the email again and starts 30 days again. After the first sign-in the row stays (`accepted_at`) and does not expire, so the User can sign in again. An Admin can remove an unused invite; removing a used one is refused (409), and the way to stop access is to deactivate.
- The allow-list check is `emailMaySignIn` in `server/utils/auth.ts`: allowed domain, or an invite that was used or has not expired. It is the one place used by the user-create hook, the code request, and the sign-in hook.
- **Last active** is the newest session `updated_at`, so it has about one day of precision. Deactivated Users show "—", because their sessions are deleted.
- **Teams**: members are Agents or Admins (`canJoinTeam` in the policy module); a User who becomes a Requester or is deactivated leaves all Teams. Team names are unique (409 `TEAM_NAME_TAKEN`). A Team that owns any Ticket Type cannot be removed (409 `TEAM_OWNS_TYPES`); deleting an empty Team also deletes its memberships in one batch.
- **Permission**: `authorizeManagePeople` in `server/utils/policy.ts` (Admin only) guards every route, both in the route (`peoplePrincipal`) and again in each module function.
- **Routes**: `GET /api/v1/users` (Users, then pending invites, with Teams, status, last active), `PATCH /api/v1/users/{id}` (`role` or `active`, one of them), `POST /api/v1/invites` (`emails`, up to 20), `POST /api/v1/invites/{id}/resend`, `DELETE /api/v1/invites/{id}`, `GET/POST /api/v1/teams`, `PATCH/DELETE /api/v1/teams/{id}`, `PUT/DELETE /api/v1/teams/{id}/members/{userId}`.
- Migration `0004_issue_20_people_and_teams.sql` (renumbered at merge): `invite`, `team_member`, and `user.deactivated_at`. No seed data.
- The sign-in strip reads `GET /api/v1/settings/deployment` (issue 21), read-only.

## Glossary terms to add

- **Invite**: an Admin's permission for one email outside the allowed domains to sign in. It expires after 30 days if unused.
- **Deactivated** (User state): a User who cannot sign in and has no sessions or tokens. The User and their history stay.

## Notes for later issues

- Audit log: done in `server/utils/people.ts` (entries have `subject_type` `user`, `invite` or `team`). One gap: the invite's first sign-in (`user.create.after` in `auth.ts`) writes no entry; it only sets `accepted_at`, and the User's creation is not an Admin change. `invite_revoked` was added as well.
- Issue 07 (type editor): a Team is chosen for a Ticket Type from `GET /api/v1/teams`. Removing or moving types decides whether a Team can be removed, through `ticket_type.team_id`; if types get an archived flag, `deleteTeam` still counts archived types (the foreign key needs it).
- Issue 21 (settings): the "Sign-in" strip on the People screen shows `allowed_domains` and `methods` from the deployment endpoint. When SSO (issue 25) adds methods, only `deploymentView` changes.
- An Agent's Team does not yet filter their ticket queue; the Team is only the owner of Ticket Types. Routing by Team is later work.
- `app/utils/api-error.ts` has `apiProblem(e)` for the REST error format. `app/pages/settings.vue` has its own copy and can use it.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
