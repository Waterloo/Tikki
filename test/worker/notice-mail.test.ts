import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { capturedMail, failCapturedMail } from '../../server/utils/mail'
import { renderNoticeEmail, sendNoticeMail, settleNoticeMail } from '../../server/utils/notice-mail'
import { call, postJson, signInAs, typeId } from './helpers'

type Session = Awaited<ReturnType<typeof signInAs>>
interface Ticket { number: number, ref: string }

const h = (s: Session) => ({ cookie: s.cookie })

async function create(s: Session, title = 'Needs help') {
  const res = await postJson('/api/v1/tickets', { ticket_type_id: await typeId(s.cookie, 'GEN'), title }, h(s))
  expect(res.status).toBe(201)
  return await res.json() as Ticket
}
const patch = (s: Session, ref: string, body: unknown) => call(`/api/v1/tickets/${ref}`, { method: 'PATCH', body: JSON.stringify(body), headers: h(s) })
const comment = (s: Session, ref: string, body: unknown) => postJson(`/api/v1/tickets/${ref}/comments`, body, h(s))
const setSwitch = (s: Session, key: string, enabled: boolean) =>
  call('/api/v1/notifications/preferences', { method: 'PATCH', body: JSON.stringify({ [key]: enabled }), headers: h(s) })

/** The notification emails for one address. Sign-in codes are not in the list. */
async function mailTo(s: Session) {
  await settleNoticeMail()
  return capturedMail().filter(m => m.to === s.user.email && m.subject.startsWith('['))
}

describe('notification email', () => {
  it('ticket created: Team switch on gets an email, switch off gets none', async () => {
    const [requester, on, off] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    expect((await setSwitch(off, 'team_ticket', false)).status).toBe(200)
    const t = await create(requester, 'Printer <b>jam</b> & "smoke"')

    const [mail] = await mailTo(on)
    expect(mail!.subject).toBe(`[${t.ref}] ${requester.user.email} created ${t.ref}`)
    expect(mail!.text).toContain(`http://localhost:8787/tickets/${t.ref}`)
    expect(mail!.text).toContain('Printer <b>jam</b>')
    // Ticket text is escaped in the HTML part.
    expect(mail!.html).toContain('Printer &#60;b&#62;jam&#60;/b&#62; &#38; &#34;smoke&#34;')
    expect(mail!.html).not.toContain('<b>jam')
    expect(await mailTo(off)).toHaveLength(0)
    expect(await mailTo(requester)).toHaveLength(0)
  })

  it('assigned is always on; the actor gets nothing about their own change', async () => {
    const [requester, actor, assignee] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent')])
    const t = await create(requester)
    await setSwitch(assignee, 'team_ticket', false)
    const before = (await mailTo(assignee)).length
    expect((await patch(actor, t.ref, { assignee_id: assignee.user.id })).status).toBe(200)
    const mails = (await mailTo(assignee)).slice(before)
    expect(mails).toHaveLength(1)
    expect(mails[0]!.subject).toContain('assigned')
    expect(await mailTo(actor)).toSatisfy((m: unknown[]) => m.every(x => !JSON.stringify(x).includes('assigned')))
  })

  it('status change: the Requester gets an email only when the switch is on', async () => {
    const [on, off, agent] = await Promise.all([signInAs('requester'), signInAs('requester'), signInAs('agent')])
    await setSwitch(off, 'status_changed', false)
    const a = await create(on)
    const b = await create(off)
    for (const t of [a, b]) expect((await patch(agent, t.ref, { status: 'resolved' })).status).toBe(200)
    expect((await mailTo(on)).filter(m => m.subject.includes(`${a.ref} to`))).toHaveLength(1)
    expect(await mailTo(off)).toHaveLength(0)
  })

  it('public comment: Requester and assignee by their switches; internal comment off by default', async () => {
    const [requester, agent, assignee, author] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('agent'), signInAs('agent')])
    const t = await create(requester)
    await patch(agent, t.ref, { assignee_id: assignee.user.id })
    const base = { requester: (await mailTo(requester)).length, assignee: (await mailTo(assignee)).length }

    expect((await comment(author, t.ref, { body: 'Public reply', visibility: 'public' })).status).toBe(201)
    expect((await mailTo(requester)).slice(base.requester)).toHaveLength(1)
    expect((await mailTo(assignee)).slice(base.assignee).map(m => m.subject)).toEqual([expect.stringContaining('replied')])

    // Internal note: off by default, so the assignee gets nothing. Turn it on and the next note arrives.
    expect((await comment(author, t.ref, { body: 'Secret note', visibility: 'internal' })).status).toBe(201)
    expect((await mailTo(assignee)).filter(m => m.text.includes('Secret note'))).toHaveLength(0)
    await setSwitch(assignee, 'internal_comment', true)
    await comment(author, t.ref, { body: 'Second secret', visibility: 'internal' })
    expect((await mailTo(assignee)).filter(m => m.text.includes('Second secret'))).toHaveLength(1)
  })

  it('a Requester never gets an email about an Internal Comment', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    await comment(agent, t.ref, { body: 'Staff only', visibility: 'internal' })
    expect((await mailTo(requester)).filter(m => m.text.includes('Staff only'))).toHaveLength(0)

    // Even a stray notice row is not mailed to a Requester.
    const { id } = (await env.DB.prepare("INSERT INTO notification (user_id, kind, ticket_number, actor_id, created_at) VALUES (?, 'internal_comment', ?, ?, ?) RETURNING id")
      .bind(requester.user.id, t.number, agent.user.id, Date.now()).first<{ id: number }>())!
    await env.DB.prepare('INSERT OR IGNORE INTO notification_mail (notification_id, at) SELECT id, 0 FROM notification WHERE id != ? AND ticket_number = ?').bind(id, t.number).run()
    await sendNoticeMail(drizzle(env.DB, { schema }), { ticket: t.number }, { transport: { send: async m => void capturedMail().push(m) }, appUrl: 'http://localhost:8787' })
    expect(await mailTo(requester)).toHaveLength(0)
  })

  it('a deactivated User gets no email', async () => {
    const [requester, gone] = await Promise.all([signInAs('requester'), signInAs('agent')])
    await env.DB.prepare('UPDATE user SET deactivated_at = ? WHERE id = ?').bind(Date.now(), gone.user.id).run()
    await create(requester)
    expect(await mailTo(gone)).toHaveLength(0)
  })

  it('transport none: nothing is sent, the Inbox is unchanged, and old notices are not sent later', async () => {
    const [requester, agent] = await Promise.all([signInAs('requester'), signInAs('agent')])
    const t = await create(requester)
    // The capture transport already sent it. Clear the claim to act as if `none` ran first.
    await env.DB.prepare('DELETE FROM notification_mail WHERE notification_id IN (SELECT id FROM notification WHERE ticket_number = ?)').bind(t.number).run()
    const sent = capturedMail().length
    const db = drizzle(env.DB, { schema })
    await sendNoticeMail(db, { ticket: t.number }, { transport: null, appUrl: 'http://localhost:8787' })
    expect(capturedMail()).toHaveLength(sent)
    const inbox = await (await call('/api/v1/notifications', { headers: h(agent) })).json() as { data: { href: string }[] }
    expect(inbox.data.some(n => n.href === `/tickets/${t.ref}`)).toBe(true)
    // A later real transport does not send the old notice.
    await sendNoticeMail(db, { ticket: t.number }, { transport: { send: async m => void capturedMail().push(m) }, appUrl: 'http://localhost:8787' })
    expect(capturedMail()).toHaveLength(sent)
  })

  it('a transport error keeps the change, and Admins see it until a send works', async () => {
    const [requester, agent, admin] = await Promise.all([signInAs('requester'), signInAs('agent'), signInAs('admin')])
    const t = await create(requester)
    failCapturedMail('Daily email limit reached.')
    try {
      const res = await patch(agent, t.ref, { status: 'resolved' })
      expect(res.status).toBe(200)
      await settleNoticeMail()
      const row = await env.DB.prepare('SELECT status FROM ticket WHERE number = ?').bind(t.number).first<{ status: string }>()
      expect(row!.status).toBe('resolved')
      const inbox = await (await call('/api/v1/notifications', { headers: h(requester) })).json() as { data: { kind: string }[] }
      expect(inbox.data.some(n => n.kind === 'status_changed')).toBe(true)

      const deployment = await (await call('/api/v1/settings/deployment', { headers: h(admin) })).json() as { mail: { last_error: { message: string } | null } }
      expect(deployment.mail.last_error?.message).toBe('Daily email limit reached.')

      const test = await postJson('/api/v1/settings/mail/test', {}, h(admin))
      expect(test.status).toBe(502)
    } finally {
      failCapturedMail(null)
    }
    const ok = await postJson('/api/v1/settings/mail/test', {}, h(admin))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ sent_to: admin.user.email })
    expect(capturedMail().at(-1)).toMatchObject({ to: admin.user.email, subject: 'Test email' })
    const after = await (await call('/api/v1/settings/deployment', { headers: h(admin) })).json() as { mail: { last_error: unknown } }
    expect(after.mail.last_error).toBeNull()
  })

  it('only Admins can send a test email', async () => {
    const agent = await signInAs('agent')
    expect((await postJson('/api/v1/settings/mail/test', {}, h(agent))).status).toBe(403)
    expect((await postJson('/api/v1/settings/mail/test', {})).status).toBe(401)
  })

  it('renders a one-line subject and escaped HTML', () => {
    const mail = renderNoticeEmail({ head: 'Hi\r\nBcc: x@evil.test', body: '<img src=x onerror=1>', href: '/tickets/GEN-1', ref: 'GEN-1' }, 'http://localhost:8787')
    expect(mail.subject).not.toMatch(/[\r\n]/)
    expect(mail.html).not.toContain('<img')
  })
})
