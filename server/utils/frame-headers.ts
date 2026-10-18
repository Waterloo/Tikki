// No site may frame Tikki (clickjacking). Static pages get the same headers from public/_headers.
const FRAME_ANCESTORS = "frame-ancestors 'none'"
export const FRAME_HEADERS = {
  'Content-Security-Policy': FRAME_ANCESTORS,
  'X-Frame-Options': 'DENY',
} as const

export function withFrameHeaders(response: Response): Response {
  // A new Response, because the headers of a fetched or redirect Response can be immutable.
  const framed = new Response(response.body, response)
  // Downloads and the logo already send a CSP (sandbox). Add to it, never replace it.
  const csp = framed.headers.get('Content-Security-Policy')
  framed.headers.set('Content-Security-Policy', csp ? `${csp}; ${FRAME_ANCESTORS}` : FRAME_ANCESTORS)
  framed.headers.set('X-Frame-Options', FRAME_HEADERS['X-Frame-Options'])
  return framed
}
