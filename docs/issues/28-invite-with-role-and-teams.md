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

- [ ] REST test: an invite as Agent with two Teams gives a User with role Agent in those two Teams at the first sign-in.
- [ ] REST test: an invite on an allowed domain sets the role and Teams; without an invite the User is a Requester.
- [ ] REST test: Teams on a Requester invite are refused (422). A Team that does not exist is refused.
- [ ] REST test: changing a pending invite's role and Teams applies the new values; a used invite cannot be changed.
- [ ] REST test: only Admins can invite or change invites. Each change writes an audit entry.
- [ ] Playwright flow: an Admin invites a person as Agent in a Team, the person signs in, and the People list shows them as Agent in that Team.

## Blocked by

None. Builds on issue 20 and the admin audit entries (done).
