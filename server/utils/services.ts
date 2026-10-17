import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { createAuth, type Auth } from './auth'
import { fetchClientMetadataResource, isCimdUrlAllowed } from './cimd-fetch'
import { config, env } from './env'
import { createMailTransport } from './mail'

export const db = drizzle(env.DB, { schema })

let auth: Auth | undefined

/** One Better-Auth instance for each isolate. Building it on every request would cost CPU we do not have. */
export function useAuth(): Auth {
  auth ??= createAuth({
    config,
    db,
    mail: createMailTransport(config, env),
    fetchClientMetadataResource,
    isMetadataDocumentUrlAllowed: isCimdUrlAllowed,
  })
  return auth
}
