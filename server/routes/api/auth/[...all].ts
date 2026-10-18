import { limitMessage, SIGN_IN_LIMIT, takeSlot } from '../../../utils/rate-limit'
import { db, useAuth } from '../../../utils/services'

// Sign-in and code requests. Token, consent and session routes are not sign-in attempts.
const SIGN_IN_PATH = /^\/api\/auth\/(sign-in|email-otp)\//

export default defineEventHandler(async (event) => {
  if (event.method === 'POST' && SIGN_IN_PATH.test(event.path)) {
    // Cloudflare sets this header. Without it (local dev) all callers share one counter.
    const ip = event.headers.get('cf-connecting-ip') ?? 'unknown'
    const limited = await takeSlot(db, `sign-in:${ip}`, SIGN_IN_LIMIT)
    if (limited) {
      // Better-Auth's own error shape, so the sign-in page shows the message like the other refusals.
      return Response.json({ code: 'TOO_MANY_REQUESTS', message: limitMessage('sign-in attempts from this network', limited) }, { status: 429, headers: { 'retry-after': String(limited.retryAfter) } })
    }
  }
  return useAuth().handler(toWebRequest(event))
})
