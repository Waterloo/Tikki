import { cimd } from '@better-auth/cimd'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { mcp } from '@better-auth/mcp'
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP, jwt } from 'better-auth/plugins'
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
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

function deactivated() {
  return new APIError('FORBIDDEN', {
    code: 'ACCOUNT_DEACTIVATED',
    message: 'This account is deactivated. Ask an Admin to turn it on again.',
  })
}

/**
 * The one place that decides who may sign in (3.15, 3.16): an allowed domain, or an invite that was used
 * or has not expired. Checking the domain first keeps the common case free of a query.
 */
export async function emailMaySignIn(config: Config, db: Db, email: string, now = Date.now()): Promise<boolean> {
  if (emailDomainAllowed(config, email)) return true
  const invited = await db.$count(
    schema.invite,
    and(
      eq(schema.invite.email, email.toLowerCase()),
      or(isNotNull(schema.invite.acceptedAt), gt(schema.invite.expiresAt, new Date(now))),
    ),
  )
  return invited > 0
}

async function assertNotDeactivated(db: Db, email: string) {
  const [row] = await db.select({ at: schema.user.deactivatedAt, email: schema.user.email }).from(schema.user).where(eq(schema.user.email, email.toLowerCase())).limit(1)
  if (row?.at) throw deactivated()
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
  /** Gives the User the Teams of their pending invite and marks it used, in one batch (3.33). */
  async function acceptInvite(userId: string, rawEmail: string) {
    const email = rawEmail.toLowerCase()
    const pending = and(eq(schema.invite.email, email), isNull(schema.invite.acceptedAt), gt(schema.invite.expiresAt, new Date()))
    try {
      await db.batch([
        db.insert(schema.teamMember).select(
          db.select({
            teamId: schema.inviteTeam.teamId,
            userId: sql<string>`${userId}`.as('user_id'),
            createdAt: sql<number>`${Date.now()}`.as('created_at'),
          }).from(schema.inviteTeam).innerJoin(schema.invite, eq(schema.invite.id, schema.inviteTeam.inviteId)).where(pending),
        ).onConflictDoNothing(),
        db.update(schema.invite).set({ acceptedAt: new Date() }).where(pending),
      ])
    } catch (error) {
      console.error('invite: Teams were not applied for', email, error)
      throw error
    }
  }

  return betterAuth({
    appName: 'Ticketing',
    baseURL: config.appUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.appUrl],
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false }),
    // Sign-in limits for each IP are in server/routes/api/auth/[...all].ts; the per-address code limit is in the hook below.
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
        // Set when an Admin deactivates the User (3.18). Null means active.
        deactivatedAt: { type: 'date', required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            const email = user.email.toLowerCase()
            if (!await emailMaySignIn(config, db, email)) throw domainNotAllowed()
            // A pending invite presets the role (3.33), also on an allowed domain. An expired one does not.
            const [pending] = await db.select({ role: schema.invite.role }).from(schema.invite)
              .where(and(eq(schema.invite.email, email), isNull(schema.invite.acceptedAt), gt(schema.invite.expiresAt, new Date()))).limit(1)
            let role: Role = pending?.role ?? 'requester'
            // The variable has no effect once an Admin exists (3.13).
            if (config.adminEmail === email) {
              const admins = await db.$count(schema.user, eq(schema.user.role, 'admin'))
              if (admins === 0) role = 'admin'
            }
            return { data: { ...user, role } }
          },
          // The User row is already saved here, and Better-Auth gives no hook inside its insert, so the Teams are a second
          // batch. If it fails, the sign-in fails visibly, and the next sign-in applies them (session hook below).
          async after(user) {
            await acceptInvite(user.id, user.email)
          },
        },
      },
      // Every sign-in method ends here, so a deactivated User gets no new session (3.18).
      session: {
        create: {
          async before(session) {
            const [row] = await db.select({ at: schema.user.deactivatedAt, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, session.userId)).limit(1)
            if (row?.at) throw deactivated()
            // Finishes an invite whose Teams were not applied at the first sign-in. Without a pending invite it changes nothing.
            await acceptInvite(session.userId, row!.email)
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
          if (!await emailMaySignIn(config, db, email)) throw domainNotAllowed()
          await assertNotDeactivated(db, email)
          await takeOtpSlot(db, email, Date.now())
        }
        if (ctx.path === '/sign-in/email-otp') {
          const email = String(ctx.body?.email ?? '')
          if (!await emailMaySignIn(config, db, email)) throw domainNotAllowed()
          await assertNotDeactivated(db, email)
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
