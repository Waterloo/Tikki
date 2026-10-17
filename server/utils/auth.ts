import { cimd } from '@better-auth/cimd'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { mcp } from '@better-auth/mcp'
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP, jwt } from 'better-auth/plugins'
import { and, eq, gt, lt } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { emailDomainAllowed, type Config } from './config'
import type { MailTransport } from './mail'

export type Db = DrizzleD1Database<typeof schema>
export type Role = 'admin' | 'agent' | 'requester'

export const OTP_LIMIT_PER_HOUR = 5
const HOUR_MS = 60 * 60 * 1000

interface AuthDeps {
  config: Config
  db: Db
  mail: MailTransport
  fetchClientMetadataResource: ClientMetadataResourceFetch
  isMetadataDocumentUrlAllowed: (clientIdUrl: string) => boolean
}

function domainNotAllowed() {
  return new APIError('FORBIDDEN', {
    code: 'EMAIL_DOMAIN_NOT_ALLOWED',
    message: 'This email domain is not allowed to sign in.',
  })
}

/** Records one code request, or refuses it when the address already had 5 in the last hour. */
async function takeOtpSlot(db: Db, email: string, now: number) {
  const since = now - HOUR_MS
  const recent = await db.$count(schema.otpRequest, and(eq(schema.otpRequest.email, email), gt(schema.otpRequest.createdAt, new Date(since))))
  if (recent >= OTP_LIMIT_PER_HOUR) {
    throw new APIError('TOO_MANY_REQUESTS', {
      code: 'TOO_MANY_CODE_REQUESTS',
      message: `At most ${OTP_LIMIT_PER_HOUR} sign-in codes an hour can be sent to one address. Use the last code you got, or try again later.`,
    })
  }
  await db.batch([
    db.delete(schema.otpRequest).where(and(eq(schema.otpRequest.email, email), lt(schema.otpRequest.createdAt, new Date(since)))),
    db.insert(schema.otpRequest).values({ email, createdAt: new Date(now) }),
  ])
}

export function createAuth({ config, db, mail, fetchClientMetadataResource, isMetadataDocumentUrlAllowed }: AuthDeps) {
  return betterAuth({
    appName: 'Ticketing',
    baseURL: config.appUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.appUrl],
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false }),
    // Rate limits on sign-in for each IP come in issue 23; the per-address code limit is in the hook below.
    rateLimit: { enabled: false },
    disabledPaths: [
      // The JWT plugin's session-to-JWT endpoint is not used; OAuth access tokens come from /oauth2/token.
      '/token',
      // No passwords (3.3): the email OTP plugin also ships password-reset endpoints.
      '/email-otp/request-password-reset',
      '/email-otp/reset-password',
      '/forget-password/email-otp',
    ],
    user: {
      additionalFields: {
        role: { type: 'string', required: true, input: false, defaultValue: 'requester' },
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            const email = user.email.toLowerCase()
            if (!emailDomainAllowed(config, email)) throw domainNotAllowed()
            // The variable has no effect once an Admin exists (3.13).
            let role: Role = 'requester'
            if (config.adminEmail === email) {
              const admins = await db.$count(schema.user, eq(schema.user.role, 'admin'))
              if (admins === 0) role = 'admin'
            }
            return { data: { ...user, role } }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/email-otp/send-verification-otp') {
          const email = String(ctx.body?.email ?? '').toLowerCase()
          if (ctx.body?.type !== 'sign-in') {
            throw new APIError('BAD_REQUEST', { code: 'UNSUPPORTED_OTP_TYPE', message: 'Only sign-in codes are supported.' })
          }
          if (!emailDomainAllowed(config, email)) throw domainNotAllowed()
          await takeOtpSlot(db, email, Date.now())
        }
        if (ctx.path === '/sign-in/email-otp' && !emailDomainAllowed(config, String(ctx.body?.email ?? ''))) {
          throw domainNotAllowed()
        }
      }),
    },
    plugins: [
      jwt(),
      emailOTP({
        storeOTP: 'hashed',
        expiresIn: 10 * 60,
        allowedAttempts: 3,
        async sendVerificationOTP({ email, otp }) {
          await mail.send({
            to: email,
            subject: `Your sign-in code: ${otp}`,
            text: `Your sign-in code is ${otp}\n\nType it on the sign-in page. It expires in 10 minutes.\nIf you did not ask for this code, you can ignore this email.`,
          })
        },
      }),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource: config.mcpResource,
        // DCR is the fallback for clients that do not use CIMD.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: 'infer',
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
        isMetadataDocumentUrlAllowed,
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
