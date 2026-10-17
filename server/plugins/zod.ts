import { z } from 'zod'

export default defineNitroPlugin(() => {
  // Workers forbid `new Function`; without this, zod probes for it on first use.
  z.config({ jitless: true })
})
