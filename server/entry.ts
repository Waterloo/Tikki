import cloudflare from 'nitropack/presets/cloudflare/runtime/cloudflare-module'
import { withFrameHeaders } from './utils/frame-headers'
import { handleUpload } from './utils/upload'

// The standard Nitro entry, with the upload routes in front (see handleUpload).
// Every response passes through withFrameHeaders here, including the ones that bypass Nitro.
export default {
  ...cloudflare,
  async fetch(request, env, context) {
    return withFrameHeaders((await handleUpload(request)) ?? (await cloudflare.fetch!(request, env, context)))
  },
} satisfies typeof cloudflare
