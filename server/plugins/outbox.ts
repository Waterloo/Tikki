import { db } from '../utils/services'
import { runOutbox } from '../utils/webhooks'

// The Cron Trigger in wrangler.jsonc. Nitro's Worker entry forwards `scheduled` to this hook; a custom entry must too.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', ({ controller }) => runOutbox(db, new Date(controller.scheduledTime)))
})
