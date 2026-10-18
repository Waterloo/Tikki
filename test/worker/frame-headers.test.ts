import { describe, expect, it } from 'vitest'
import staticHeaders from '../../public/_headers?raw'
import { FRAME_HEADERS, withFrameHeaders } from '../../server/utils/frame-headers'

describe('frame headers', () => {
  it('are set on a response, also when its headers are immutable', () => {
    const framed = withFrameHeaders(Response.redirect('https://example.com/', 302))
    expect(framed.status).toBe(302)
    for (const [name, value] of Object.entries(FRAME_HEADERS)) expect(framed.headers.get(name)).toBe(value)
  })

  it('keep a CSP that the response already has', () => {
    const framed = withFrameHeaders(new Response('x', { headers: { 'content-security-policy': "default-src 'none'; sandbox" } }))
    expect(framed.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox; frame-ancestors 'none'")
  })

  it('match the static _headers file', () => {
    for (const [name, value] of Object.entries(FRAME_HEADERS)) expect(staticHeaders).toContain(`  ${name}: ${value}`)
  })
})
