import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { env, exports } from 'cloudflare:workers'
import { capturedMail } from '../../server/utils/mail'

export const BASE = 'http://localhost:8787'
export const MCP_URL = `${BASE}/mcp`
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

const worker = (exports as unknown as { default: Fetcher }).default

/** Sends a request to the built Worker. Relative paths resolve against the test APP_URL. */
export function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  // Better-Auth refuses cookie-carrying POSTs without a trusted Origin.
  if (!headers.has('origin')) headers.set('origin', BASE)
  // Each call is a new client, so the per-IP sign-in limit does not couple tests. Tests of that limit send their own IP.
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', `10.${counter++ % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`)
  return worker.fetch(new URL(path, BASE), { ...init, headers, redirect: 'manual' })
}

export function postJson(path: string, body: unknown, headers: HeadersInit = {}) {
  return call(path, { method: 'POST', body: JSON.stringify(body), headers })
}

let counter = 0
export function uniqueEmail(domain = 'example.com') {
  return `user${Date.now()}${counter++}@${domain}`
}

export function requestCode(email: string) {
  return postJson('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
}

/** The code in the last email that the capture transport got for this address. */
export function lastCode(email: string): string | undefined {
  const mail = capturedMail().filter(m => m.to === email).at(-1)
  return mail ? /code is (\d{6})/.exec(mail.text)?.[1] : undefined
}

function cookieHeader(res: Response) {
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

/** Signs in with an email code, like the web page does. Returns the session cookie and the user. */
export async function signIn(email: string) {
  const sent = await requestCode(email)
  if (sent.status !== 200) throw new Error(`code request failed: ${sent.status} ${await sent.text()}`)
  const res = await postJson('/api/auth/sign-in/email-otp', { email, otp: lastCode(email) })
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  const body = await res.json() as { user: { id: string, email: string, role: string } }
  return { cookie: cookieHeader(res), user: body.user }
}

function base64url(bytes: ArrayBuffer | Uint8Array) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A redirect from Better-Auth: a 302 for navigations, or `{ redirect, url }` JSON for fetches. */
async function redirectTarget(res: Response): Promise<URL> {
  const location = res.headers.get('location') ?? ((await res.json()) as { url?: string }).url
  if (!location) throw new Error(`expected a redirect, got ${res.status}`)
  return new URL(location, BASE)
}

/**
 * Gets an MCP access token through the same OAuth flow that Claude uses:
 * DCR, authorize with PKCE and `resource`, consent, and the code exchange.
 */
export async function getMcpToken(cookie: string) {
  const reg = await postJson('/api/auth/oauth2/register', {
    client_name: 'Test connector',
    redirect_uris: [CALLBACK],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  })
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${await reg.text()}`)
  const { client_id } = await reg.json() as { client_id: string }

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const query = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: CALLBACK,
    scope: 'openid profile email offline_access',
    state: 'test-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
  })
  const consentPage = await redirectTarget(await call(`/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }))
  if (consentPage.pathname !== '/consent') throw new Error(`expected the consent page, got ${consentPage}`)

  const consent = await postJson('/api/auth/oauth2/consent', { accept: true, oauth_query: consentPage.search.slice(1) }, { cookie })
  const callback = await redirectTarget(consent)
  const code = callback.searchParams.get('code')
  if (!code) throw new Error(`no code in ${callback}`)

  const tokenRes = await call('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id, code_verifier: verifier, resource: MCP_URL }),
  })
  if (tokenRes.status !== 200) throw new Error(`token failed: ${tokenRes.status} ${await tokenRes.text()}`)
  const tokens = await tokenRes.json() as { access_token: string, refresh_token: string }
  return { ...tokens, client_id }
}

export { worker }

/** An MCP client on the test Worker with this access token. */
export async function connectMcp(accessToken: string, mode: 'modern' | 'legacy' = 'legacy') {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (input, init) => worker.fetch(input as string, init),
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  })
  await client.connect(transport, mode === 'legacy' ? { prior: { kind: 'legacy' } } : {})
  return client
}

type Role = 'admin' | 'agent' | 'requester'

/** Signs in a new User with this role. Role changes come with issue 20, so the test sets the role in the database. */
export async function signInAs(role: Role) {
  const session = await signIn(uniqueEmail())
  if (role !== 'requester') await env.DB.prepare('UPDATE user SET role = ? WHERE id = ?').bind(role, session.user.id).run()
  return { ...session, user: { ...session.user, role } }
}

/**
 * A new Ticket Type with "visible to all internal Users" and one optional Field. The Admin type editor comes with
 * issue 07, so the test writes the rows. A new type, not a seeded one, so other tests keep their seed.
 */
export async function createVisibleType(): Promise<number> {
  const prefix = `V${Array.from(crypto.getRandomValues(new Uint8Array(4)), b => String.fromCharCode(65 + (b % 26))).join('')}`
  const type = await env.DB.prepare(
    `INSERT INTO ticket_type (name, prefix, description, team_id, visible_to_all, created_at)
     VALUES (?, ?, 'Company-wide notices.', (SELECT id FROM team WHERE name = 'Support'), 1, ?) RETURNING id`,
  ).bind(`Shared ${prefix}`, prefix, Date.now()).first<{ id: number }>()
  await env.DB.prepare('INSERT INTO schema_version (ticket_type_id, version, fields, created_at) VALUES (?, 1, ?, ?)')
    .bind(type!.id, JSON.stringify([{ key: 'office', label: 'Office', type: 'short_text', required: false, help: 'Which office.' }]), Date.now()).run()
  return type!.id
}

/** The ID of a seeded Ticket Type, by its prefix. */
export async function typeId(cookie: string, prefix: string): Promise<number> {
  const { data } = await (await call('/api/v1/ticket-types', { headers: { cookie } })).json() as { data: { id: number, prefix: string }[] }
  const found = data.find(t => t.prefix === prefix)
  if (!found) throw new Error(`no Ticket Type with prefix ${prefix}`)
  return found.id
}

export interface AdminAuditRow {
  action: string
  subject_type: string
  subject_id: string
  principal_id: string
  channel: string
  before: unknown
  after: unknown
}

/** The audit entries of one non-ticket subject, oldest first, with the values parsed. */
export async function adminAuditOf(subjectType: string, subjectId: string | number): Promise<AdminAuditRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM audit_log WHERE subject_type = ? AND subject_id = ? ORDER BY id').bind(subjectType, String(subjectId)).all<Record<string, string | null>>()
  return results.map(r => ({ ...r, before: r.before === null ? null : JSON.parse(r.before), after: r.after === null ? null : JSON.parse(r.after) }) as AdminAuditRow)
}
