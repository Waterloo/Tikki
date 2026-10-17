import { describe, expect, it } from 'vitest'
import { capturedMail } from '../../server/utils/mail'
import { call, lastCode, postJson, requestCode, signIn, uniqueEmail } from './helpers'

describe('email code sign-in', () => {
  it('sends a code to an allowed address, and the code signs the User in', async () => {
    const email = uniqueEmail('example.org')
    const sent = await requestCode(email)
    expect(sent.status).toBe(200)
    expect(lastCode(email)).toMatch(/^\d{6}$/)

    const res = await postJson('/api/auth/sign-in/email-otp', { email, otp: lastCode(email) })
    expect(res.status).toBe(200)
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    expect((await call('/api/v1/tickets', { headers: { cookie } })).status).toBe(200)
  })

  it('sends no code to an address from another domain', async () => {
    const email = uniqueEmail('evil.test')
    const res = await requestCode(email)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'EMAIL_DOMAIN_NOT_ALLOWED' })
    expect(capturedMail().some(m => m.to === email)).toBe(false)
  })

  it('does not match a subdomain or a look-alike of an allowed domain', async () => {
    for (const email of [uniqueEmail('sub.example.com'), uniqueEmail('example.com.evil.test')]) {
      expect((await requestCode(email)).status).toBe(403)
    }
  })

  it('refuses a wrong code', async () => {
    const email = uniqueEmail()
    await requestCode(email)
    const wrong = lastCode(email) === '000000' ? '111111' : '000000'
    const res = await postJson('/api/auth/sign-in/email-otp', { email, otp: wrong })
    expect(res.status).toBe(400)
  })

  it('refuses the 6th code request in an hour for one address', async () => {
    const email = uniqueEmail()
    for (let i = 0; i < 5; i++) expect((await requestCode(email)).status).toBe(200)
    const sixth = await requestCode(email)
    expect(sixth.status).toBe(429)
    expect(await sixth.json()).toMatchObject({ code: 'TOO_MANY_CODE_REQUESTS' })
    expect(capturedMail().filter(m => m.to === email)).toHaveLength(5)
    // The limit is for each address, so another address still gets a code.
    expect((await requestCode(uniqueEmail())).status).toBe(200)
  })

  it('counts addresses without regard to letter case', async () => {
    const email = uniqueEmail()
    for (let i = 0; i < 5; i++) await requestCode(i % 2 ? email.toUpperCase() : email)
    expect((await requestCode(email)).status).toBe(429)
  })

  it('has no password or magic-link sign-in', async () => {
    const email = uniqueEmail()
    for (const path of ['/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/auth/sign-in/magic-link', '/api/auth/email-otp/request-password-reset']) {
      const res = await postJson(path, { email, password: 'x'.repeat(12), name: 'x' })
      expect(res.status, path).toBeGreaterThanOrEqual(400)
      expect(res.headers.getSetCookie(), path).toEqual([])
    }
    const other = await postJson('/api/auth/email-otp/send-verification-otp', { email, type: 'forget-password' })
    expect(other.status).toBe(400)
  })

  it('gives a new User the Requester role', async () => {
    const { user } = await signIn(uniqueEmail())
    expect(user.role).toBe('requester')
  })
})
