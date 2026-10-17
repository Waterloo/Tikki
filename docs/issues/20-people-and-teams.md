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

- [ ] REST test: a deactivated User's session and MCP token are refused at once.
- [ ] REST test: an invited email from another domain can sign in. A not-invited one cannot.
- [ ] REST test: removing a Team that owns a type is refused.
- [ ] REST test: only Admins can change roles.
- [ ] The audit log records each role change, invite, and deactivation.

## Blocked by

- [05 · Roles, policy, and the agent queue](05-roles-and-agent-queue.md)
