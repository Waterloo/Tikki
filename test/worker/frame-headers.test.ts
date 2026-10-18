import { describe, expect, it } from 'vitest'
import staticHeaders from '../../public/_headers?raw'
import { FRAME_HEADERS, withFrameHeaders } from '../../server/utils/frame-headers'

describe('frame headers', () => {
  it('are set on a response, also when its headers are immutable', () => {
    const framed = withFrameHeaders(Response.redirect('https://example.com/', 302))
    expect(framed.status).toBe(302)
    for (const [name, value] of Object.entries(FRAME_HEADERS)) expect(framed.headers.get(name)).toBe(value)
  })

  it('match the static _headers file', () => {
    for (const [name, value] of Object.entries(FRAME_HEADERS)) expect(staticHeaders).toContain(`  ${name}: ${value}`)
  })
})
