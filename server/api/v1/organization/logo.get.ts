import { env } from '../../../utils/env'
import { apiError } from '../../../utils/rest'
import { readLogo } from '../../../utils/settings'

// Public, like the name. The version in the URL changes with the logo, so the browser may keep it for long.
export default defineEventHandler(async () => {
  const bytes = await readLogo(env.DB)
  if (!bytes) return apiError(404, 'NOT_FOUND', 'There is no logo.')
  return new Response(bytes.buffer as ArrayBuffer, {
    headers: {
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'default-src \'none\'; sandbox',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})
