import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { adminAuditOf, call, signIn, signInAs, uniqueEmail } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>
interface Person { id: string | null, invite_id: number | null, email: string, role: string, status: string, teams: { id: number, name: string }[] }
interface ErrorBody { error: { code: string, details: { key: string, reason: string }[] | null } }

const send = (s: Pick<Session, 'cookie'>, method: string, path: string, body?: unknown) =>
  call(path, { method, headers: { cookie: s.cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
const people = async (s: Session) => (await (await send(s, 'GET', '/api/v1/users')).json() as { data: Person[] }).data
const invite = (s: Session, body: unknown) => send(s, 'POST', '/api/v1/invites', body)
const newTeam = async (s: Session, name: string) => (await (await send(s, 'POST', '/api/v1/teams', { name: `${name} ${Date.now()}${Math.random()}` })).json() as { id: number }).id
const pendingOf = async (s: Session, email: string) => (await people(s)).find(p => p.email === email)!

describe('invite with a role and Teams', () => {
  it('gives an Agent role and two Teams at the first sign-in', async () => {
    const admin = await signInAs('admin')
    const [a, b] = [await newTeam(admin, 'Inv A'), await newTeam(admin, 'Inv B')]
    const email = uniqueEmail('contractor.test')
    expect((await invite(admin, { emails: [email], role: 'agent', team_ids: [a, b, a] })).status).toBe(201)
    const pending = await pendingOf(admin, email)
    expect(pending).toMatchObject({ role: 'agent', status: 'invited' })
    expect(pending.teams.map(t => t.id).sort()).toEqual([a, b].sort())

    const session = await signIn(email)
    expect(session.user.role).toBe('agent')
    const row = (await people(admin)).filter(p => p.email === email)
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ id: session.user.id, role: 'agent', status: 'active' })
    expect(row[0]!.teams.map(t => t.id).sort()).toEqual([a, b].sort())
  })

  it('applies the Teams at the next sign-in when they failed at the first one', async () => {
    const admin = await signInAs('admin')
    const team = await newTeam(admin, 'Inv Retry')
    const email = uniqueEmail('contractor.test')
    expect((await invite(admin, { emails: [email], role: 'agent', team_ids: [team] })).status).toBe(201)

    await env.DB.prepare("CREATE TRIGGER team_member_fails BEFORE INSERT ON team_member BEGIN SELECT RAISE(ABORT, 'test failure'); END").run()
    try {
      await expect(signIn(email)).rejects.toThrow()
    } finally {
      await env.DB.prepare('DROP TRIGGER team_member_fails').run()
    }
    // The User exists with the right role, and the invite is still pending.
    expect(await pendingOf(admin, email)).toMatchObject({ role: 'agent', teams: [] })

    expect((await signIn(email)).user.role).toBe('agent')
    const row = await pendingOf(admin, email)
    expect(row).toMatchObject({ role: 'agent', status: 'active' })
    expect(row.teams.map(t => t.id)).toEqual([team])
  })

  it('sets the role on an allowed domain, and a plain domain sign-in stays a Requester', async () => {
    const admin = await signInAs('admin')
    const team = await newTeam(admin, 'Inv Dom')
    const invited = uniqueEmail('example.com')
    const plain = uniqueEmail('example.com')
    expect((await invite(admin, { emails: [invited], role: 'admin', team_ids: [team] })).status).toBe(201)
    expect((await signIn(invited)).user.role).toBe('admin')
    expect((await people(admin)).find(p => p.email === invited)!.teams.map(t => t.id)).toEqual([team])
    expect((await signIn(plain)).user.role).toBe('requester')
  })

  it('defaults to Requester and ignores an expired invite on an allowed domain', async () => {
    const admin = await signInAs('admin')
    const email = uniqueEmail('example.com')
    await invite(admin, { emails: [email], role: 'agent' })
    const { invite_id } = await pendingOf(admin, email)
    await env.DB.prepare('UPDATE invite SET expires_at = ? WHERE id = ?').bind(Date.now() - 1000, invite_id).run()
    expect((await signIn(email)).user.role).toBe('requester')
    const plain = uniqueEmail('contractor.test')
    await invite(admin, { emails: [plain] })
    expect((await signIn(plain)).user.role).toBe('requester')
  })

  it('refuses Teams on a Requester invite and a Team that does not exist, and saves nothing', async () => {
    const admin = await signInAs('admin')
    const team = await newTeam(admin, 'Inv Req')
    const email = uniqueEmail('contractor.test')
    const requester = await invite(admin, { emails: [email], team_ids: [team] })
    expect(requester.status).toBe(422)
    expect((await requester.json() as ErrorBody).error.details![0]!.key).toBe('team_ids')
    const missing = await invite(admin, { emails: [email], role: 'agent', team_ids: [team, 999999] })
    expect(missing.status).toBe(422)
    expect((await invite(admin, { emails: [], role: 'agent' })).status).toBe(422)
    expect((await invite(admin, { emails: [email], role: 'owner' })).status).toBe(422)
    expect((await people(admin)).some(p => p.email === email)).toBe(false)
  })

  it('changes a pending invite, and refuses to change a used one', async () => {
    const admin = await signInAs('admin')
    const [a, b] = [await newTeam(admin, 'Chg A'), await newTeam(admin, 'Chg B')]
    const email = uniqueEmail('contractor.test')
    await invite(admin, { emails: [email], role: 'agent', team_ids: [a] })
    const id = (await pendingOf(admin, email)).invite_id!

    expect((await send(admin, 'PATCH', `/api/v1/invites/${id}`, { role: 'requester', team_ids: [b] })).status).toBe(422)
    expect((await send(admin, 'PATCH', `/api/v1/invites/${id}`, { role: 'admin', team_ids: [b] })).status).toBe(204)
    expect(await pendingOf(admin, email)).toMatchObject({ role: 'admin', teams: [{ id: b }] })

    expect((await send(admin, 'PATCH', `/api/v1/invites/${id}`, { role: 'requester' })).status).toBe(204)
    expect((await pendingOf(admin, email)).teams).toEqual([])
    await send(admin, 'PATCH', `/api/v1/invites/${id}`, { role: 'agent', team_ids: [a, b] })

    const log = await adminAuditOf('invite', id)
    expect(log.map(e => e.action)).toEqual(['user_invited', 'invite_changed', 'invite_changed', 'invite_changed'])
    expect(log[0]!.after).toEqual({ email, role: 'agent', team_ids: [a] })
    expect(log[1]).toMatchObject({ before: { role: 'agent', team_ids: [a] }, after: { role: 'admin', team_ids: [b] } })

    const session = await signIn(email)
    expect(session.user.role).toBe('agent')
    expect((await people(admin)).find(p => p.id === session.user.id)!.teams.map(t => t.id).sort()).toEqual([a, b].sort())

    const used = await send(admin, 'PATCH', `/api/v1/invites/${id}`, { role: 'admin', team_ids: [] })
    expect(used.status).toBe(409)
    expect((await used.json() as ErrorBody).error.code).toBe('INVITE_ACCEPTED')
    expect((await send(admin, 'PATCH', '/api/v1/invites/999999', { role: 'agent', team_ids: [] })).status).toBe(404)
  })

  it('lets only Admins invite or change invites, and audits the removal', async () => {
    const [admin, agent, requester] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('requester')])
    const email = uniqueEmail('contractor.test')
    await invite(admin, { emails: [email], role: 'agent' })
    const id = (await pendingOf(admin, email)).invite_id!
    for (const who of [agent, requester]) {
      expect((await invite(who, { emails: [uniqueEmail('contractor.test')], role: 'agent' })).status).toBe(403)
      expect((await send(who, 'PATCH', `/api/v1/invites/${id}`, { role: 'admin', team_ids: [] })).status).toBe(403)
    }
    expect((await send({ cookie: '' }, 'PATCH', `/api/v1/invites/${id}`, { role: 'admin', team_ids: [] })).status).toBe(401)
    expect(await pendingOf(admin, email)).toMatchObject({ role: 'agent' })

    const team = await newTeam(admin, 'Inv Rm')
    await send(admin, 'PATCH', `/api/v1/invites/${id}`, { role: 'agent', team_ids: [team] })
    expect((await send(admin, 'DELETE', `/api/v1/invites/${id}`)).status).toBe(204)
    const log = await adminAuditOf('invite', id)
    expect(log.map(e => e.action)).toEqual(['user_invited', 'invite_changed', 'invite_revoked'])
    for (const e of log) expect(e).toMatchObject({ principal_id: admin.user.id, channel: 'web' })
    const left = await env.DB.prepare('SELECT count(*) AS n FROM invite_team WHERE invite_id = ?').bind(id).first<{ n: number }>()
    expect(left!.n).toBe(0)
    // A Team in a pending invite does not block deleting the Team.
    const other = await newTeam(admin, 'Inv Del')
    const e2 = uniqueEmail('contractor.test')
    await invite(admin, { emails: [e2], role: 'agent', team_ids: [other] })
    expect((await send(admin, 'DELETE', `/api/v1/teams/${other}`)).status).toBe(204)
    expect((await pendingOf(admin, e2)).teams).toEqual([])
  })
})
