export type AppEnv = 'development' | 'test' | 'staging' | 'production'
export type MailTransportName = 'cloudflare' | 'console' | 'capture' | 'none'

export interface Config {
  appEnv: AppEnv
  appUrl: string
  /** The MCP URL. Claude connectors need the token `resource` to equal it exactly. */
  mcpResource: string
  authSecret: string
  allowedEmailDomains: string[]
  adminEmail: string | null
  mailTransport: MailTransportName
  mailFrom: string | null
  /** RATE_LIMITS=off. For local development and tests only (DECISIONS 10). */
  rateLimitsOff: boolean
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Invalid configuration: ${message}`)
    this.name = 'ConfigError'
  }
}

const APP_ENVS: AppEnv[] = ['development', 'test', 'staging', 'production']
const MAIL_TRANSPORTS: MailTransportName[] = ['cloudflare', 'console', 'capture', 'none']

type RawEnv = Record<string, unknown>

function str(env: RawEnv, name: string): string | undefined {
  const value = env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** Reads and checks the environment. Throws a ConfigError that names the variable to fix. */
export function readConfig(env: RawEnv): Config {
  const appEnv = str(env, 'APP_ENV') as AppEnv | undefined
  if (!appEnv || !APP_ENVS.includes(appEnv)) {
    throw new ConfigError(`APP_ENV must be one of ${APP_ENVS.join(', ')}.`)
  }

  const rawUrl = str(env, 'APP_URL')
  if (!rawUrl) throw new ConfigError('APP_URL is required, for example https://tickets.example.com.')
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ConfigError(`APP_URL "${rawUrl}" is not an absolute URL.`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new ConfigError('APP_URL must use https (http is allowed only for localhost).')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError('APP_URL must be an origin only, with no path, query or fragment.')
  }
  const appUrl = url.origin

  const authSecret = str(env, 'BETTER_AUTH_SECRET')
  if (!authSecret || authSecret.length < 32) {
    throw new ConfigError('BETTER_AUTH_SECRET is required and must have at least 32 characters.')
  }

  const domains = (str(env, 'ALLOWED_EMAIL_DOMAINS') ?? '')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  if (domains.length === 0) {
    throw new ConfigError(
      'ALLOWED_EMAIL_DOMAINS is required when email sign-in is on. Set a comma-separated list, for example "example.com,example.org".',
    )
  }

  const mailTransport = str(env, 'MAIL_TRANSPORT') as MailTransportName | undefined
  if (!mailTransport || !MAIL_TRANSPORTS.includes(mailTransport)) {
    throw new ConfigError(`MAIL_TRANSPORT must be one of ${MAIL_TRANSPORTS.join(', ')}.`)
  }
  // Codes in Workers Logs would let anyone who reads the logs take over accounts.
  if (mailTransport === 'console' && appEnv !== 'development') {
    throw new ConfigError(
      `MAIL_TRANSPORT=console is allowed only when APP_ENV=development (APP_ENV is "${appEnv}"). It writes sign-in codes to the logs.`,
    )
  }
  if (mailTransport === 'capture' && appEnv !== 'test') {
    throw new ConfigError(`MAIL_TRANSPORT=capture is allowed only when APP_ENV=test (APP_ENV is "${appEnv}").`)
  }
  if (mailTransport === 'none') {
    throw new ConfigError(
      'MAIL_TRANSPORT=none needs at least one SSO provider, and SSO is not available yet. Use MAIL_TRANSPORT=cloudflare.',
    )
  }
  const mailFrom = str(env, 'MAIL_FROM') ?? null
  if (mailTransport === 'cloudflare') {
    if (!mailFrom) throw new ConfigError('MAIL_FROM is required when MAIL_TRANSPORT=cloudflare.')
    if (!env.EMAIL) throw new ConfigError('The EMAIL send_email binding is required when MAIL_TRANSPORT=cloudflare.')
  }

  const rateLimitsOff = str(env, 'RATE_LIMITS') === 'off'
  if (rateLimitsOff && appEnv !== 'development' && appEnv !== 'test') {
    throw new ConfigError(`RATE_LIMITS=off is allowed only when APP_ENV is development or test (APP_ENV is "${appEnv}").`)
  }

  return {
    appEnv,
    appUrl,
    mcpResource: `${appUrl}/mcp`,
    authSecret,
    allowedEmailDomains: domains,
    adminEmail: str(env, 'ADMIN_EMAIL')?.toLowerCase() ?? null,
    mailTransport,
    mailFrom,
    rateLimitsOff,
  }
}

export function emailDomainAllowed(config: Config, email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at < 1) return false
  return config.allowedEmailDomains.includes(email.slice(at + 1).toLowerCase())
}
