# 28 · Invite with a role and Teams

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

An Admin onboards a person in one step: the invite sets their role and Teams, and the User has them from the first sign-in.

- The invite dialog gets a role (Requester by default, Agent, Admin) and, for Agent and Admin, Teams. All emails in one invite get the same role and Teams.
- An Admin can also invite an email on an allowed domain, only to set the role and Teams before the first sign-in. Without an invite, such a person still signs in as a Requester.
- The role and Teams are applied in the same step that creates the User at the first sign-in. A User never exists with the wrong role.
- A pending invite shows its role and Teams in the People list. The Admin can change them, resend or remove the invite.
- Each invite, change of a pending invite and removal is in the audit log, like a role change.

## Acceptance criteria

- [x] REST test: an invite as Agent with two Teams gives a User with role Agent in those two Teams at the first sign-in.
  Evidence: `test/worker/invite-role.test.ts`, "gives an Agent role and two Teams at the first sign-in" (a duplicate Team id in the request is merged; the pending row shows both Teams; after sign-in the User is Agent in both Teams and there is one row).
- [x] REST test: an invite on an allowed domain sets the role and Teams; without an invite the User is a Requester.
  Evidence: "sets the role on an allowed domain, and a plain domain sign-in stays a Requester" (an Admin invite on `@example.com` gives an Admin with the Team; an uninvited address is a Requester). "defaults to Requester and ignores an expired invite on an allowed domain".
- [x] REST test: Teams on a Requester invite are refused (422). A Team that does not exist is refused.
  Evidence: "refuses Teams on a Requester invite and a Team that does not exist, and saves nothing" (422 on `team_ids`, no row saved; also an empty list and an unknown role).
- [x] REST test: changing a pending invite's role and Teams applies the new values; a used invite cannot be changed.
  Evidence: "changes a pending invite, and refuses to change a used one" (PATCH replaces role and Teams; the sign-in then uses the new values; a used invite answers 409 `INVITE_ACCEPTED`, an unknown id 404).
- [x] REST test: only Admins can invite or change invites. Each change writes an audit entry.
  Evidence: "lets only Admins invite or change invites, and audits the removal" (Agent and Requester 403, no session 401; entries `user_invited`, `invite_changed`, `invite_revoked` with the Admin as Principal and channel `web`; `before` and `after` hold role and `team_ids`).
- [x] Playwright flow: an Admin invites a person as Agent in a Team, the person signs in, and the People list shows them as Agent in that Team.
  Evidence: `e2e/people.spec.ts`, "an Admin invites an Agent into a Team, and the People list shows them after the first sign-in".

## Blocked by

None. Builds on issue 20 and the admin audit entries (done).

## Not verified

- The invite dialog, the Edit dialog and the People list were driven by Playwright only (28 e2e tests pass, incl. the 375 px no-scroll check). I did not look at them in a browser, in light or dark mode, or against the canvas. The failure path of the Teams batch in `user.create.after` (see Decisions) has no test; it cannot be forced without a broken database.
- The invite email does not state the role (it says only that you were invited).

## Decisions made here

- **Storage**: `invite.role` (text, default `requester`) and a table `invite_team (invite_id, team_id)` with real foreign keys (`invite` cascades). A JSON column would not keep the Team foreign key honest. Migration `0020_issue_28_invite_role.sql` (renumbered at merge). Deleting a Team also deletes its rows in `invite_team` (in the same batch), so a pending invite just loses that Team.
- **Applying**: `user.create.before` reads the pending, unexpired invite for the email and presets `role` (the `ADMIN_EMAIL` bootstrap still wins for its address). `user.create.after` copies the Teams into `team_member` and sets `accepted_at` in one `db.batch` (INSERT ... SELECT from `invite_team`). **Limit**: Better-Auth gives no hook inside its own insert and D1 has no interactive transaction, so the User row is written before the Teams. The role is never wrong; if the Teams batch fails, the error is logged and thrown (the sign-in fails visibly), the User has the right role but no Teams, and the invite stays pending in the People list.
- **Expired invite on an allowed domain** presets nothing (the User signs in as a Requester). An expired invite outside the domain still refuses sign-in, as before.
- **Validation** (one function, `checkRoleAndTeams`): Teams only if the role may join a Team (`canJoinTeam`), else 422 on `team_ids`; every Team must exist, else 422. At least one email. All emails in a request share role and Teams. Duplicate Team ids are merged.
- **Change a pending invite**: `PATCH /api/v1/invites/{id}` with `role` and `team_ids` (both replace the old values; omitted `team_ids` means none). 409 `INVITE_ACCEPTED` for a used invite. Audit action `invite_changed` (new in `AUDIT_ACTIONS`) with `before`/`after` of role and Team ids.
- **Create**: `POST /api/v1/invites` takes `role` (default `requester`) and `team_ids` (default `[]`). `user_invited` entries now hold `{ email, role, team_ids }` in `after`. An address with an account is still refused; the "needs no invite" refusal is gone.
- **UI**: `InviteDialog` has a Role select and a Teams multi-select (shown for Agent and Admin) and doubles as the "Edit invite" dialog for a pending row (new "Edit" button next to Resend and Remove). The People list shows the invite's role and Teams. The actions column is wider (230 px).
- The canvas has no role or Team control in the invite dialog, so the controls follow the existing form style.

## Glossary terms to add

None. (Invite now "presets the role and Teams"; DECISIONS 3.30 and 3.33 already say so.)

## Notes for later issues

- `listPeople` returns the invite's role and Teams in the same fields as a User row.
- If more per-invite presets come, add columns to `invite`; `user.create.before/after` in `server/utils/auth.ts` are the two places that apply them.
