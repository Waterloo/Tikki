import { and, asc, inArray, isNull } from 'drizzle-orm'
import { team, teamMember, user } from '../db/schema'
import type { Db } from './auth'
import { authorizeListAssignees, PolicyRefusal } from './policy'
import type { Principal } from './tickets'

export interface AssigneeList {
  /** Active Agents and Admins. Requesters are never listed. */
  data: { id: string, name: string, email: string, role: string, team_ids: number[] }[]
  teams: { id: number, name: string }[]
}

/** For the assignee picker and the Team picker of the ticket page. Agents and Admins only. */
export async function listAssignees(db: Db, principal: Principal): Promise<AssigneeList> {
  const refusal = authorizeListAssignees(principal)
  if (refusal) throw new PolicyRefusal(refusal)
  const [people, members, teams] = await db.batch([
    db.select({ id: user.id, name: user.name, email: user.email, role: user.role }).from(user)
      .where(and(isNull(user.deactivatedAt), // The same roles as `canBeAssignee` in policy.ts.
      inArray(user.role, ['admin', 'agent']))).orderBy(asc(user.name), asc(user.email)),
    db.select({ teamId: teamMember.teamId, userId: teamMember.userId }).from(teamMember),
    db.select({ id: team.id, name: team.name }).from(team).orderBy(asc(team.name)),
  ])
  const teamsOf = Map.groupBy(members, m => m.userId)
  return {
    data: people.map(p => ({ ...p, team_ids: (teamsOf.get(p.id) ?? []).map(m => m.teamId) })),
    teams,
  }
}
