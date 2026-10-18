import type { AppEnv } from './config'
import { config } from './env'
import { readLimited } from './settings'

// The fetch of a URL that an Admin gives Tikki (webhook endpoints, Ticket App manifests). CIMD has its own transport
// with an allow list (`cimd-fetch.ts`), because the OAuth plugin calls it with its own options.

const PRIVATE_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/

function privateIpv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
}

function privateIpv6(host: string): boolean {
  if (!host.startsWith('[')) return false
  const h = host.slice(1, -1)
  // Loopback, unspecified, IPv4-mapped, unique local (fc00::/7), link-local (fe80::/10).
  return h === '::1' || h === '::' || h.startsWith('::ffff:') || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
}

const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/**
 * Why Tikki must not send a request to this URL, or null. Only https, and no private or link-local address by name.
 * A loopback address only in development. The URL parser has already turned other IPv4 forms (`2130706433`, `0x7f.1`)
 * into dotted form. The Worker cannot see the address that a public name resolves to, so this check works on the name only.
 */
export function publicUrlProblem(url: URL, appEnv: AppEnv = config.appEnv): string | null {
  const host = url.hostname.toLowerCase()
  if (appEnv === 'development' && isLoopback(host)) return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'Must use https.'
  if (url.protocol !== 'https:') return 'Must use https.'
  if (url.username || url.password) return 'Must not contain a user name or password.'
  if (PRIVATE_NAMES.test(host) || privateIpv4(host) || privateIpv6(host)) return 'Must be a public address. Private, loopback and link-local addresses are refused.'
  return null
}

/** A refused or failed fetch. `message` is for the Admin. */
export class FetchRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FetchRefused'
  }
}

const MAX_REDIRECTS = 3

export interface SafeGetOptions {
  maxBytes: number
  /** The message when the body is larger than `maxBytes`. */
  tooLarge: string
  accept: string
  timeoutMs?: number
}

/**
 * GETs a public URL and returns the body. Each URL passes `publicUrlProblem`. A redirect is followed only on the same
 * origin: the check ran on the origin, and another origin could be a private address. The timeout covers the body too.
 * Throws `FetchRefused` for every failure that the caller can show.
 */
export async function safeGet(value: string, options: SafeGetOptions): Promise<Uint8Array> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new FetchRefused('Must be an absolute URL.')
  }
  const problem = publicUrlProblem(url)
  if (problem) throw new FetchRefused(problem)
  const timeoutMs = options.timeoutMs ?? 5000
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    for (let hop = 0; ; hop++) {
      const res = await globalThis.fetch(url, { method: 'GET', headers: { accept: options.accept }, redirect: 'manual', signal })
      if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
        await res.body?.cancel()
        const next = new URL(res.headers.get('location')!, url)
        if (next.origin !== url.origin) throw new FetchRefused(`The server redirects to another origin (${next.origin}). Use the final address.`)
        if (hop >= MAX_REDIRECTS) throw new FetchRefused('The server redirects too many times.')
        url = next
        continue
      }
      if (!res.ok) {
        await res.body?.cancel()
        throw new FetchRefused(`The server answered ${res.status}.`)
      }
      return await readLimited(res, options.maxBytes, () => new FetchRefused(options.tooLarge))
    }
  } catch (error) {
    if (error instanceof FetchRefused) throw error
    if (signal.aborted) throw new FetchRefused(`The server did not answer within ${timeoutMs / 1000} seconds.`)
    // A network error: the message of workerd names the cause (DNS, TLS, connection refused).
    throw new FetchRefused(`Tikki could not reach the server: ${error instanceof Error ? error.message : String(error)}`)
  }
}
