import { cleanupUploads } from '../utils/cleanup'
import { env } from '../utils/env'
import { db } from '../utils/services'
import { deleteOldCounters } from '../utils/rate-limit'
import { runOutbox } from '../utils/webhooks'

// The Cron Trigger in wrangler.jsonc. Nitro's Worker entry forwards `scheduled` to this hook; a custom entry must too.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    await runOutbox(db, new Date(controller.scheduledTime))
    await deleteOldCounters(db)
    await cleanupUploads(db, env.FILES, new Date(controller.scheduledTime))
  })
})
