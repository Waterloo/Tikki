import { env } from 'cloudflare:workers'
import { capturedMail } from '../../server/utils/mail'
import { describe, expect, it } from 'vitest'
import { call, getMcpToken, MCP_URL, postJson, requestCode, signIn, signInAs, uniqueEmail } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>

interface Person {
  id: string | null
  invite_id: number | null
  email: string
  role: string
  status: string
  teams: { id: number, name: string }[]
}
interface Team {
  id: number
  name: string
  members: { id: string, role: string }[]
  owns: { id: number, name: string }[]
}
interface ErrorBody { error: { code: string, message: string, details: { key: string, reason: string }[] | null } }

const send = (s: Pick<Session, 'cookie'>, method: string, path: string, body?: unknown) =>
  call(path, { method, headers: { cookie: s.cookie }, body: body === undefined ? undefined : JSON.stringify(body) })

const people = async (s: Session) => (await (await send(s, 'GET', '/api/v1/users')).json() as { data: Person[] }).data
const teams = async (s: Session) => (await (await send(s, 'GET', '/api/v1/teams')).json() as { data: Team[] }).data
const patchUser = (s: Session, id: string, body: unknown) => send(s, 'PATCH', `/api/v1/users/${id}`, body)
const invite = (s: Session, ...emails: string[]) => send(s, 'POST', '/api/v1/invites', { emails })
const errorOf = async (res: Response) => (await res.json() as ErrorBody).error

const mcpPing = (token: string) => call('/mcp', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
})

function refresh(clientId: string, refreshToken: string) {
  return call('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource: MCP_URL }),
  })
}

describe('roles', () => {
  it('lets only Admins change roles, and every other People route is Admin only', async () => {
    const [admin, agent, requester] = await Promise.all([signInAs('admin'), signInAs('agent'), signInAs('requester')])
    const target = await signInAs('requester')

    for (const who of [agent, requester]) {
      const res = await patchUser(who, target.user.id, { role: 'admin' })
      expect(res.status).toBe(403)
      expect(await errorOf(res)).toMatchObject({ code: 'FORBIDDEN', message: 'Only Admins can manage people and Teams.' })
      expect((await send(who, 'GET', '/api/v1/users')).status).toBe(403)
      expect((await send(who, 'GET', '/api/v1/teams')).status).toBe(403)
      expect((await invite(who, uniqueEmail('contractor.test'))).status).toBe(403)
      expect((await send(who, 'POST', '/api/v1/teams', { name: 'Nope' })).status).toBe(403)
    }
    expect((await patchUser({ cookie: '' }, target.user.id, { role: 'agent' })).status).toBe(401)
    expect(await env.DB.prepare('SELECT role FROM user WHERE id = ?').bind(target.user.id).first()).toEqual({ role: 'requester' })

    const res = await patchUser(admin, target.user.id, { role: 'agent' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ data: { id: target.user.id, role: 'agent' } })
    // The new role applies to the next request of the target.
    expect((await send(target, 'GET', '/api/v1/users')).status).toBe(403)
    expect((await (await call('/api/auth/get-session', { headers: { cookie: target.cookie } })).json() as { user: { role: string } }).user.role).toBe('agent')
  })

  it('rejects a role that does not exist, and an unknown User', async () => {
    const admin = await signInAs('admin')
    const target = await signInAs('requester')
    expect((await patchUser(admin, target.user.id, { role: 'owner' })).status).toBe(422)
    expect((await patchUser(admin, target.user.id, {})).status).toBe(422)
    expect((await patchUser(admin, target.user.id, { role: 'agent', active: false })).status).toBe(422)
    expect((await patchUser(admin, 'no-such-user', { role: 'agent' })).status).toBe(404)
  })

  it('keeps one active Admin: no self-deactivation, no demotion of the last Admin', async () => {
    // This file's database has the Admins of other tests, so end with exactly one active Admin first.
    const admin = await signInAs('admin')
    await env.DB.prepare('UPDATE user SET deactivated_at = ? WHERE role = \'admin\' AND id != ?').bind(Date.now(), admin.user.id).run()

    const self = await patchUser(admin, admin.user.id, { active: false })
    expect(self.status).toBe(403)
    expect((await errorOf(self)).message).toBe('You cannot deactivate yourself. Ask another Admin.')

    const demote = await patchUser(admin, admin.user.id, { role: 'agent' })
    expect(demote.status).toBe(409)
    expect((await errorOf(demote)).code).toBe('LAST_ADMIN')
    expect(await env.DB.prepare('SELECT role FROM user WHERE id = ?').bind(admin.user.id).first()).toEqual({ role: 'admin' })

    // With a second Admin, the first can step down.
    const second = await signInAs('admin')
    expect((await patchUser(second, admin.user.id, { role: 'agent' })).status).toBe(200)
    // Now the second is the last one.
    const again = await patchUser(second, second.user.id, { role: 'requester' })
    expect(again.status).toBe(409)
  })
})

describe('invites', () => {
  it('lets an invited email from another domain sign in, and refuses one that is not invited', async () => {
    const admin = await signInAs('admin')
    const invited = uniqueEmail('contractor.test')
    const stranger = uniqueEmail('contractor.test')

    expect((await requestCode(invited)).status).toBe(403)
    expect((await postJson('/api/auth/sign-in/email-otp', { email: invited, otp: '123456' })).status).toBe(403)

    const res = await invite(admin, invited.toUpperCase())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ invited: [invited] })
    expect(capturedMail().some(m => m.to === invited && m.text.includes('/sign-in'))).toBe(true)
    expect((await people(admin)).find(p => p.email === invited)).toMatchObject({ id: null, status: 'invited', role: 'requester' })

    const session = await signIn(invited)
    expect(session.user.role).toBe('requester')
    // The invite is used: the person is a User now, and can sign in again.
    const row = (await people(admin)).filter(p => p.email === invited)
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ id: session.user.id, status: 'active' })
    await signIn(invited)

    // A different address on the same domain is not let in.
    expect((await requestCode(stranger)).status).toBe(403)
  })

  it('refuses an expired invite until it is sent again, and a revoked invite', async () => {
    const admin = await signInAs('admin')
    const email = uniqueEmail('contractor.test')
    await invite(admin, email)
    const id = (await people(admin)).find(p => p.email === email)!.invite_id

    await env.DB.prepare('UPDATE invite SET expires_at = ? WHERE id = ?').bind(Date.now() - 1000, id).run()
    expect((await people(admin)).find(p => p.email === email)?.status).toBe('expired')
    expect((await requestCode(email)).status).toBe(403)

    expect((await send(admin, 'POST', `/api/v1/invites/${id}/resend`)).status).toBe(204)
    expect((await people(admin)).find(p => p.email === email)?.status).toBe('invited')
    expect((await requestCode(email)).status).toBe(200)

    expect((await send(admin, 'DELETE', `/api/v1/invites/${id}`)).status).toBe(204)
    expect((await requestCode(email)).status).toBe(403)
    expect((await send(admin, 'DELETE', `/api/v1/invites/${id}`)).status).toBe(404)
  })

  it('refuses a list with an address that needs no invite, has an account, is invited, or is not an email', async () => {
    const admin = await signInAs('admin')
    const existing = await signIn('sam@example.org')
    const fresh = uniqueEmail('contractor.test')
    await invite(admin, uniqueEmail('contractor.test'))
    const again = uniqueEmail('contractor.test')
    await invite(admin, again)

    const res = await invite(admin, fresh, 'colleague@example.com', existing.user.email, again, 'not-an-email')
    expect(res.status).toBe(422)
    const { details } = await errorOf(res)
    expect(details!.map(d => d.reason)).toEqual([
      'colleague@example.com is already allowed to sign in by domain, so it needs no invite.',
      'sam@example.org is already allowed to sign in by domain, so it needs no invite.',
      `${again} is already invited. Use Resend to send the invite again.`,
      'not-an-email is not a valid email address.',
    ])
    // All or none: the valid address was not saved.
    expect((await people(admin)).some(p => p.email === fresh)).toBe(false)
    expect((await invite(admin)).status).toBe(422)
  })

  it('refuses to revoke an invite that was used', async () => {
    const admin = await signInAs('admin')
    const email = uniqueEmail('contractor.test')
    await invite(admin, email)
    const id = (await people(admin)).find(p => p.email === email)!.invite_id
    await signIn(email)
    const res = await send(admin, 'DELETE', `/api/v1/invites/${id}`)
    expect(res.status).toBe(409)
    expect((await errorOf(res)).code).toBe('INVITE_ACCEPTED')
  })
})

describe('deactivation', () => {
  it('stops the session, the MCP token and the refresh token at once, and blocks sign-in', async () => {
    const admin = await signInAs('admin')
    const victim = await signIn(uniqueEmail())
    const tokens = await getMcpToken(victim.cookie)

    expect((await mcpPing(tokens.access_token)).status).toBe(200)
    expect((await call('/api/v1/tickets', { headers: { cookie: victim.cookie } })).status).toBe(200)

    const res = await patchUser(admin, victim.user.id, { active: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ data: { status: 'deactivated' } })

    // The access token is a JWT that has not expired: the MCP check on the User refuses it.
    const mcp = await mcpPing(tokens.access_token)
    expect(mcp.status).toBe(401)
    expect(mcp.headers.get('www-authenticate')).toContain('resource_metadata=')
    expect((await call('/api/v1/tickets', { headers: { cookie: victim.cookie } })).status).toBe(401)
    const refreshed = await refresh(tokens.client_id, tokens.refresh_token)
    expect(refreshed.status).toBeGreaterThanOrEqual(400)
    expect(await refreshed.json()).toMatchObject({ error: 'invalid_grant' })

    for (const attempt of [() => requestCode(victim.user.email), () => postJson('/api/auth/sign-in/email-otp', { email: victim.user.email, otp: '123456' })]) {
      const refused = await attempt()
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({ code: 'ACCOUNT_DEACTIVATED' })
    }
  })

  it('refuses a valid MCP access token when only the flag is set (the JWT is still valid)', async () => {
    const victim = await signIn(uniqueEmail())
    const tokens = await getMcpToken(victim.cookie)
    expect((await mcpPing(tokens.access_token)).status).toBe(200)
    await env.DB.prepare('UPDATE user SET deactivated_at = ? WHERE id = ?').bind(Date.now(), victim.user.id).run()
    expect((await mcpPing(tokens.access_token)).status).toBe(401)
  })

  it('lets the User sign in again after reactivation, and keeps the User in the list', async () => {
    const admin = await signInAs('admin')
    const email = uniqueEmail()
    const victim = await signIn(email)
    await patchUser(admin, victim.user.id, { active: false })
    expect((await people(admin)).find(p => p.id === victim.user.id)?.status).toBe('deactivated')
    expect((await requestCode(email)).status).toBe(403)

    expect((await patchUser(admin, victim.user.id, { active: true })).status).toBe(200)
    expect((await people(admin)).find(p => p.id === victim.user.id)?.status).toBe('active')
    await signIn(email)
  })
})

describe('Teams', () => {
  it('creates, renames and refuses a duplicate name', async () => {
    const admin = await signInAs('admin')
    const created = await send(admin, 'POST', '/api/v1/teams', { name: '  Finance ops ' })
    expect(created.status).toBe(201)
    const team = await created.json() as Team
    expect(team).toMatchObject({ name: 'Finance ops', members: [], owns: [] })

    expect((await send(admin, 'POST', '/api/v1/teams', { name: 'Finance ops' })).status).toBe(409)
    expect((await send(admin, 'POST', '/api/v1/teams', { name: '   ' })).status).toBe(422)
    expect((await send(admin, 'PATCH', `/api/v1/teams/${team.id}`, { name: 'Support' })).status).toBe(409)

    const renamed = await send(admin, 'PATCH', `/api/v1/teams/${team.id}`, { name: 'Finance' })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({ id: team.id, name: 'Finance' })
    expect((await send(admin, 'PATCH', '/api/v1/teams/9999', { name: 'X' })).status).toBe(404)
  })

  it('adds an Agent to several Teams, refuses a Requester, and removes a member', async () => {
    const admin = await signInAs('admin')
    const agent = await signInAs('agent')
    const requester = await signInAs('requester')
    const [a, b] = await Promise.all(['Team A', 'Team B'].map(async name => await (await send(admin, 'POST', '/api/v1/teams', { name: `${name} ${Date.now()}` })).json() as Team))

    expect((await send(admin, 'PUT', `/api/v1/teams/${a!.id}/members/${agent.user.id}`)).status).toBe(200)
    const second = await send(admin, 'PUT', `/api/v1/teams/${b!.id}/members/${agent.user.id}`)
    expect(await second.json()).toMatchObject({ members: [{ id: agent.user.id }] })
    // Adding twice changes nothing.
    expect((await send(admin, 'PUT', `/api/v1/teams/${b!.id}/members/${agent.user.id}`)).status).toBe(200)
    expect((await people(admin)).find(p => p.id === agent.user.id)?.teams.map(t => t.id).sort()).toEqual([a!.id, b!.id].sort())

    const refused = await send(admin, 'PUT', `/api/v1/teams/${a!.id}/members/${requester.user.id}`)
    expect(refused.status).toBe(409)
    expect((await errorOf(refused)).code).toBe('NOT_AN_AGENT')
    expect((await send(admin, 'PUT', `/api/v1/teams/${a!.id}/members/nobody`)).status).toBe(404)

    // An Admin can be a member too (3.17).
    expect((await send(admin, 'PUT', `/api/v1/teams/${a!.id}/members/${admin.user.id}`)).status).toBe(200)

    const removed = await send(admin, 'DELETE', `/api/v1/teams/${a!.id}/members/${agent.user.id}`)
    expect((await removed.json() as Team).members.map(m => m.id)).toEqual([admin.user.id])
    expect((await teams(admin)).find(t => t.id === b!.id)!.members).toHaveLength(1)
  })

  it('removes a User from every Team when the User becomes a Requester or is deactivated', async () => {
    const admin = await signInAs('admin')
    const [x, y] = [await signInAs('agent'), await signInAs('agent')]
    const team = await (await send(admin, 'POST', '/api/v1/teams', { name: `Cleanup ${Date.now()}` })).json() as Team
    for (const u of [x, y]) await send(admin, 'PUT', `/api/v1/teams/${team.id}/members/${u.user.id}`)

    await patchUser(admin, x.user.id, { role: 'requester' })
    await patchUser(admin, y.user.id, { active: false })
    expect((await teams(admin)).find(t => t.id === team.id)!.members).toEqual([])
    expect((await send(admin, 'PUT', `/api/v1/teams/${team.id}/members/${y.user.id}`)).status).toBe(409)
  })

  it('refuses to remove a Team that owns a Ticket Type, and removes one that owns none', async () => {
    const admin = await signInAs('admin')
    const support = (await teams(admin)).find(t => t.name === 'Support')!
    expect(support.owns.length).toBeGreaterThan(0)

    const refused = await send(admin, 'DELETE', `/api/v1/teams/${support.id}`)
    expect(refused.status).toBe(409)
    expect(await errorOf(refused)).toMatchObject({
      code: 'TEAM_OWNS_TYPES',
      message: `Support owns ${support.owns.length} Ticket Types. Move them to another Team first.`,
    })
    expect((await teams(admin)).some(t => t.id === support.id)).toBe(true)

    const empty = await (await send(admin, 'POST', '/api/v1/teams', { name: `Empty ${Date.now()}` })).json() as Team
    const agent = await signInAs('agent')
    await send(admin, 'PUT', `/api/v1/teams/${empty.id}/members/${agent.user.id}`)
    expect((await send(admin, 'DELETE', `/api/v1/teams/${empty.id}`)).status).toBe(204)
    expect((await teams(admin)).some(t => t.id === empty.id)).toBe(false)
    expect((await send(admin, 'DELETE', `/api/v1/teams/${empty.id}`)).status).toBe(404)
  })
})
