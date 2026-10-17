import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { createAuth, type Auth } from './auth'
import { fetchClientMetadataResource, isCimdUrlAllowed } from './cimd-fetch'
import { config, env } from './env'
import { createMailTransport, type MailTransport } from './mail'

export const db = drizzle(env.DB, { schema })

let auth: Auth | undefined
let mail: MailTransport | undefined

export function useMail(): MailTransport {
  return mail ??= createMailTransport(config, env)
}

/** One Better-Auth instance for each isolate. Building it on every request would cost CPU we do not have. */
export function useAuth(): Auth {
  auth ??= createAuth({
    config,
    db,
    mail: useMail(),
    fetchClientMetadataResource,
    isMetadataDocumentUrlAllowed: isCimdUrlAllowed,
  })
  return auth
}
