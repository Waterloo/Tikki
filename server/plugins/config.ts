import { ConfigError } from '../utils/config'
import { config, env } from '../utils/env'

export default defineNitroPlugin((nitroApp) => {
  // The import above runs the configuration check at startup; this line keeps it from being tree-shaken.
  void config.appEnv
  // Cloudflare's upload check starts the Worker without its D1 binding, so the binding is checked per request.
  nitroApp.hooks.hook('request', () => {
    if (!env.DB) throw new ConfigError('The DB (D1) binding is required.')
  })
})
