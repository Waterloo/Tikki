// Config for the Better-Auth CLI only: it builds the same plugins with dummy values to generate server/db/auth-schema.ts.
import { createAuth } from '../server/utils/auth'
import { readConfig } from '../server/utils/config'

export const auth = createAuth({
  config: readConfig({
    APP_ENV: 'test',
    APP_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    ALLOWED_EMAIL_DOMAINS: 'example.com',
    MAIL_TRANSPORT: 'capture',
    DB: {},
  }),
  db: {} as never,
  mail: { send: async () => {} },
  fetchClientMetadataResource: fetch,
  isMetadataDocumentUrlAllowed: () => false,
})
