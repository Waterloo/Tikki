import cloudflare from 'nitropack/presets/cloudflare/runtime/cloudflare-module'
import { handleUpload } from './utils/upload'

// The standard Nitro entry, with the upload routes in front (see handleUpload).
export default {
  ...cloudflare,
  async fetch(request, env, context) {
    return (await handleUpload(request)) ?? cloudflare.fetch!(request, env, context)
  },
} satisfies typeof cloudflare
