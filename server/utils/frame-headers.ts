// No site may frame Tikki (clickjacking). Static pages get the same headers from public/_headers.
export const FRAME_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
} as const

export function withFrameHeaders(response: Response): Response {
  // A new Response, because the headers of a fetched or redirect Response can be immutable.
  const framed = new Response(response.body, response)
  for (const [name, value] of Object.entries(FRAME_HEADERS)) framed.headers.set(name, value)
  return framed
}
