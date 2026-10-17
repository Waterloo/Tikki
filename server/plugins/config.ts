import { config } from '../utils/env'

export default defineNitroPlugin(() => {
  // The import above runs the configuration check at startup; this line keeps it from being tree-shaken.
  void config.appEnv
})
