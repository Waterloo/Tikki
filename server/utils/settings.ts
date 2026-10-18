import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { organization, ticket } from '../db/schema'
import type { Db } from './auth'
import type { Config } from './config'

export const LOGO_MAX_BYTES = 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

export interface OrganizationView {
  name: string
  subtitle: string
  logo_url: string | null
}

export const organizationInput = z.strictObject({
  name: z.string({ error: 'Must be text.' }).trim().min(1, 'Name is required.').max(60, 'Name must be 60 characters or fewer.'),
  subtitle: z.string({ error: 'Must be text.' }).trim().max(80, 'Subtitle must be 80 characters or fewer.'),
}).partial()

export async function getOrganization(db: Db): Promise<OrganizationView> {
  const [row] = await db
    .select({ name: organization.name, subtitle: organization.subtitle, version: organization.logoVersion })
    .from(organization)
    .where(eq(organization.id, 1))
  if (!row) throw new Error('The organization row is missing. Apply the migrations.')
  return {
    name: row.name,
    subtitle: row.subtitle,
    logo_url: row.version > 0 ? `/api/v1/organization/logo?v=${row.version}` : null,
  }
}

export async function updateOrganization(db: Db, input: z.infer<typeof organizationInput>): Promise<OrganizationView> {
  if (Object.keys(input).length > 0) await db.update(organization).set(input).where(eq(organization.id, 1))
  return getOrganization(db)
}

export class LogoError extends Error {
  constructor(readonly status: 413 | 415, readonly code: string, message: string) {
    super(message)
  }
}

/** Checks the type, the size and the PNG signature. A PNG is data; an SVG can contain script, so it is never accepted. */
export function checkLogo(contentType: string | null, bytes: Uint8Array): void {
  if (contentType?.split(';')[0]?.trim().toLowerCase() !== 'image/png') {
    throw new LogoError(415, 'LOGO_NOT_PNG', 'The logo must be a PNG file.')
  }
  if (bytes.length > LOGO_MAX_BYTES) throw logoTooLarge()
  if (bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new LogoError(415, 'LOGO_NOT_PNG', 'The file is not a PNG image.')
  }
}

/** Reads a body and stops as soon as it is larger than `max`, so a huge upload costs no CPU. `tooLarge` makes the error. */
export async function readLimited(request: Pick<Request | Response, 'headers' | 'body'>, max: number, tooLarge: () => Error): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > max) throw tooLarge()
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = request.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

const logoTooLarge = () => new LogoError(413, 'LOGO_TOO_LARGE', 'The logo must be 1 MB or smaller.')
export const readLogoBody = (request: Request) => readLimited(request, LOGO_MAX_BYTES, logoTooLarge)

export async function setLogo(d1: D1Database, bytes: Uint8Array): Promise<void> {
  await d1.prepare('UPDATE organization SET logo = ?, logo_version = ? WHERE id = 1').bind(bytes, Date.now()).run()
}

export async function clearLogo(d1: D1Database): Promise<void> {
  await d1.prepare('UPDATE organization SET logo = NULL, logo_version = 0 WHERE id = 1').run()
}

export async function readLogo(d1: D1Database): Promise<Uint8Array | null> {
  const row = await d1.prepare('SELECT logo FROM organization WHERE id = 1').first<{ logo: number[] | null }>()
  return row?.logo ? new Uint8Array(row.logo) : null
}

export interface DeploymentView {
  address: string
  connector_url: string
  environment: Config['appEnv']
  sign_in: { methods: string[], allowed_domains: string[] }
  mail: { transport: Config['mailTransport'], from: string | null }
}

/** The values that come from the environment (12.3a). Never the secret. */
export function deploymentView(config: Config): DeploymentView {
  return {
    address: config.appUrl,
    connector_url: config.mcpResource,
    environment: config.appEnv,
    sign_in: { methods: ['Email code'], allowed_domains: config.allowedEmailDomains },
    mail: { transport: config.mailTransport, from: config.mailFrom },
  }
}

/** True when at least one ticket exists. Checked by an indexed primary-key lookup, so it stays cheap. */
export async function hasTickets(db: Db): Promise<boolean> {
  const [row] = await db.select({ number: ticket.number }).from(ticket).limit(1)
  return row !== undefined
}
