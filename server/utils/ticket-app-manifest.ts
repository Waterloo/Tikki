import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { APP_ICON_MAX_BYTES, DEFAULT_APP_ICON, DEFAULT_APP_ICON_COLOR, type AppIconMode } from '../../shared/ticket-app-icons'
import { accessAbove, MANIFEST_KEYS, type ManifestChange, type ManifestKey, type NormalizedManifest } from '../../shared/ticket-app-manifest'
import { ticketApp, TICKET_APP_ACCESS, type TicketAppAccess } from '../db/schema'
import { adminAuditEntry } from './audit'
import type { Db } from './auth'
import { FetchRefused, safeGet } from './safe-fetch'
import { ICON_BAD_TYPE, ICON_TOO_LARGE, iconTypeOf, putIconObjects, writeIcon, type IconImage } from './ticket-app-icons'
import {
  accessInput, accessNotRequested, appUrlProblem, audited, createTicketApp, dropIconObjects, enabledInput, getRow, invalid,
  listTicketApps, noPageForRequesters, noUrl, notFound, pageForRequestersInput, TicketAppError, typeIdsInput, type TicketAppView,
} from './ticket-apps'
import type { UserPrincipal } from './tickets'

// Issue 40: add a Ticket App from its manifest, and apply an update of it (ADR 0005, docs/ticket-apps.md#manifest).

export const MANIFEST_MAX_BYTES = 64 * 1024

const fail = (key: string, reason: string) => invalid([{ key, reason }])
const manifestChanged = () => new TicketAppError(409, 'MANIFEST_CHANGED', 'The manifest changed after the preview. Load the preview again.')
const notFromManifest = () => fail('manifest_url', 'This app was not added from a manifest.')

const manifestUrlInput = z.string({ error: 'Must be text.' }).trim().min(1, 'Paste the address of the manifest.').max(2000, 'URL must be 2000 characters or fewer.')
// The hash of the preview: "Add app" and "Apply" save exactly what the Admin saw.
const hashInput = z.string({ error: 'Must be text.' }).regex(/^[0-9a-f]{64}$/, 'Must be the hash of the preview.')

export const manifestPreviewInput = z.strictObject({ manifest_url: manifestUrlInput })

export const manifestCreateInput = z.strictObject({
  manifest_url: manifestUrlInput,
  hash: hashInput,
  /** Default: the access in the manifest. */
  access: accessInput.optional(),
  ticket_type_ids: typeIdsInput.default(null),
  page_for_requesters: pageForRequestersInput.default(false),
  enabled: enabledInput.default(true),
})

export const manifestApplyInput = z.strictObject({
  hash: hashInput,
  /** The granted access after the update. Default: the current one, lowered to the new requested access. */
  access: accessInput.optional(),
  confirm_warnings: z.boolean({ error: 'Must be true or false.' }).default(false),
})

// --- Read and check -------------------------------------------------------------------------------------------------

const text = (what: string) => ({ error: (issue: { input: unknown }) => issue.input === undefined ? 'Required.' : `Must be ${what}.` })

/** A URL of the manifest, resolved against the manifest URL. App URLs must also pass the rules of issue 37. */
const urlIn = (base: URL, appUrl: boolean) => z.string(text('text')).trim().min(1, 'Must not be empty.').max(2000, 'URL must be 2000 characters or fewer.')
  .transform((value, ctx) => {
    let url: URL
    try {
      url = new URL(value, base)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Must be a URL.' })
      return z.NEVER
    }
    const problem = appUrl ? appUrlProblem(url.href) : null
    if (problem) {
      ctx.addIssue({ code: 'custom', message: problem })
      return z.NEVER
    }
    return url.href
  })

// `z.object` drops unknown keys, so an app can add fields for a later version.
const manifestSchema = (base: URL) => z.object({
  name: z.string(text('text')).trim().min(1, 'Must not be empty.').max(40, 'Must be 40 characters or fewer.'),
  description: z.string(text('text')).trim().max(200, 'Must be 200 characters or fewer.').nullish(),
  urls: z.object({ sidebar: urlIn(base, true).nullish(), tab: urlIn(base, true).nullish(), page: urlIn(base, true).nullish() }, text('an object with sidebar, tab or page'))
    .refine(u => u.sidebar || u.tab || u.page, 'Set at least one URL: sidebar, tab or page.'),
  icons: z.object({ light: urlIn(base, false), dark: urlIn(base, false).nullish() }, text('an object with light and dark')).nullish(),
  access: z.enum(TICKET_APP_ACCESS, { error: `Must be one of ${TICKET_APP_ACCESS.join(', ')}.` }).nullish(),
})

function parseManifest(raw: unknown, base: URL) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('manifest_url', 'The manifest must be a JSON object.')
  // The version first: the other keys of an unknown version can mean something else.
  const version = (raw as Record<string, unknown>).tikki_app
  if (version === undefined) throw fail('tikki_app', 'Required. Set it to 1.')
  if (version !== 1) throw fail('tikki_app', typeof version === 'number' ? `Unknown version ${version}. This Tikki reads version 1.` : 'Must be the number 1.')
  const parsed = manifestSchema(base).safeParse(raw)
  if (!parsed.success) throw invalid(parsed.error.issues.map(i => ({ key: i.path.join('.'), reason: i.message })))
  return parsed.data
}

async function readIcon(url: string): Promise<IconImage> {
  const bytes = await safeGet(url, { maxBytes: APP_ICON_MAX_BYTES, tooLarge: ICON_TOO_LARGE, accept: 'image/png, image/webp, image/svg+xml' })
  const type = iconTypeOf(bytes)
  if (!type) throw new FetchRefused(ICON_BAD_TYPE)
  return { bytes, type }
}

async function readIcons(icons: { light: string, dark?: string | null }): Promise<{ light: IconImage, dark: IconImage | null }> {
  const [light, dark] = await Promise.allSettled([readIcon(icons.light), icons.dark ? readIcon(icons.dark) : Promise.resolve(null)])
  const problems = ([['icons.light', light], ['icons.dark', dark]] as const).flatMap(([key, r]) => {
    if (r.status === 'fulfilled') return []
    if (r.reason instanceof FetchRefused) return [{ key, reason: r.reason.message }]
    throw r.reason
  })
  if (problems.length) throw invalid(problems)
  return { light: (light as PromiseFulfilledResult<IconImage>).value, dark: (dark as PromiseFulfilledResult<IconImage | null>).value }
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (data: Uint8Array | string) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data as Uint8Array<ArrayBuffer>))

export interface ReadManifest {
  url: string
  manifest: NormalizedManifest
  /** SHA-256 of the normalized manifest. It covers the icon bytes, through their hashes. */
  hash: string
  images: { light: IconImage, dark: IconImage | null } | null
}

/**
 * Fetches the manifest and its icons with the safe fetch, and checks them. Throws a 422 that names the key for each
 * problem. Writes nothing, so a failed fetch leaves no trace.
 */
export async function readManifest(value: string): Promise<ReadManifest> {
  let base: URL
  try {
    base = new URL(value)
  } catch {
    throw fail('manifest_url', 'Must be an absolute URL, for example https://time.example.com/tikki-app.json.')
  }
  let raw: unknown
  try {
    const bytes = await safeGet(base.href, { maxBytes: MANIFEST_MAX_BYTES, tooLarge: 'The manifest must be 64 KB or smaller.', accept: 'application/json' })
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof FetchRefused) throw fail('manifest_url', error.message)
    // SyntaxError from JSON.parse, TypeError from the decoder.
    if (error instanceof SyntaxError || error instanceof TypeError) throw fail('manifest_url', 'The manifest is not valid JSON.')
    throw error
  }
  const parsed = parseManifest(raw, base)
  const images = parsed.icons ? await readIcons(parsed.icons) : null
  const iconOf = async (url: string, image: IconImage) => ({ url, sha256: await sha256(image.bytes), type: image.type })
  const manifest: NormalizedManifest = {
    version: 1,
    name: parsed.name,
    description: parsed.description || null,
    urls: { sidebar: parsed.urls.sidebar ?? null, tab: parsed.urls.tab ?? null, page: parsed.urls.page ?? null },
    icons: parsed.icons && images
      ? { light: await iconOf(parsed.icons.light, images.light), dark: parsed.icons.dark && images.dark ? await iconOf(parsed.icons.dark, images.dark) : null }
      : null,
    access: parsed.access ?? 'read',
  }
  return { url: base.href, manifest, hash: await sha256(JSON.stringify(manifest)), images }
}

// --- Preview --------------------------------------------------------------------------------------------------------

export interface ManifestPreview {
  manifest_url: string
  hash: string
  manifest: NormalizedManifest
  /** The icons as `data:` URLs: the browser of the Admin never loads them from the app's site. */
  icons: { light: string, dark: string | null } | null
}

function dataUrl(image: IconImage): string {
  let binary = ''
  // In chunks: one spread of 256 KB arguments overflows the stack.
  for (let i = 0; i < image.bytes.length; i += 0x8000) binary += String.fromCharCode(...image.bytes.subarray(i, i + 0x8000))
  return `data:${image.type};base64,${btoa(binary)}`
}

export function previewOf(read: ReadManifest): ManifestPreview {
  return {
    manifest_url: read.url,
    hash: read.hash,
    manifest: read.manifest,
    icons: read.images ? { light: dataUrl(read.images.light), dark: read.images.dark ? dataUrl(read.images.dark) : null } : null,
  }
}

// --- Add ------------------------------------------------------------------------------------------------------------

async function viewOf(db: Db, id: number): Promise<TicketAppView> {
  const view = (await listTicketApps(db)).find(a => a.id === id)
  if (!view) throw notFound()
  return view
}

/**
 * Adds the app of the manifest. Tikki fetches the manifest again: it must be the one of the preview (`hash`), so the
 * Admin approves exactly what they saw. The icons are copied into R2 after the app exists, because the R2 key needs the id.
 */
export async function createFromManifest(db: Db, bucket: R2Bucket, principal: UserPrincipal, input: z.infer<typeof manifestCreateInput>): Promise<TicketAppView> {
  const read = await readManifest(input.manifest_url)
  if (read.hash !== input.hash) throw manifestChanged()
  const { manifest } = read
  const access = input.access ?? manifest.access
  if (accessAbove(access, manifest.access)) throw accessNotRequested(manifest.access)
  const created = await createTicketApp(db, principal, {
    name: manifest.name,
    sidebar_url: manifest.urls.sidebar,
    tab_url: manifest.urls.tab,
    page_url: manifest.urls.page,
    ticket_type_ids: input.ticket_type_ids,
    access,
    enabled: input.enabled,
    icon_name: DEFAULT_APP_ICON,
    icon_color: DEFAULT_APP_ICON_COLOR,
    page_for_requesters: input.page_for_requesters,
  }, { url: read.url, hash: read.hash, manifest })
  if (!read.images) return created
  const { light, dark } = read.images
  await putIconObjects(bucket, created.id, dark ? { light, dark } : { light })
  const row = await getRow(db, created.id)
  await writeIcon(db, principal, row, { ...row, iconLightType: light.type, iconDarkType: dark?.type ?? null, iconVersion: row.iconVersion + 1 })
  return viewOf(db, created.id)
}

// --- Updates --------------------------------------------------------------------------------------------------------

function flat(m: NormalizedManifest): Record<ManifestKey, string | null> {
  return {
    'name': m.name,
    'description': m.description,
    'urls.sidebar': m.urls.sidebar,
    'urls.tab': m.urls.tab,
    'urls.page': m.urls.page,
    'icons.light': m.icons?.light.url ?? null,
    'icons.dark': m.icons?.dark?.url ?? null,
    'access': m.access,
  }
}

const iconHash = (m: NormalizedManifest, key: ManifestKey) => key === 'icons.light' ? m.icons?.light.sha256 : key === 'icons.dark' ? m.icons?.dark?.sha256 : undefined

/**
 * The keys that differ between the approved manifest and the new one. An icon also changes when its bytes change at
 * the same URL. A placement URL on an origin that no URL of the approved manifest had, and a higher requested access,
 * get a warning: the first sends tokens to a new site, the second asks for more rights.
 */
export function manifestChanges(before: NormalizedManifest, after: NormalizedManifest): ManifestChange[] {
  const a = flat(before)
  const b = flat(after)
  const origins = new Set(Object.values(before.urls).flatMap(u => u ? [new URL(u).origin] : []))
  return MANIFEST_KEYS.filter(key => a[key] !== b[key] || iconHash(before, key) !== iconHash(after, key)).map((key) => {
    const value = b[key]
    let warning: string | null = null
    if (key.startsWith('urls.') && value && !origins.has(new URL(value).origin)) warning = `New origin: ${new URL(value).origin}. Tokens for this placement go to it.`
    if (key === 'access' && accessAbove(after.access, before.access)) warning = `The app asks for more access: ${after.access}.`
    return { key, before: a[key], after: value, warning }
  })
}

export interface ManifestCheck extends ManifestPreview {
  /** Empty when the manifest did not change. */
  changes: ManifestChange[]
  /** The access the Admin granted now. */
  granted_access: TicketAppAccess
}

/** "Check for updates": fetches the manifest again and compares it with the approved one. Changes nothing. */
export async function checkManifestUpdate(db: Db, id: number): Promise<ManifestCheck> {
  const row = await getRow(db, id)
  if (!row.manifestUrl || !row.manifest) throw notFromManifest()
  const read = await readManifest(row.manifestUrl)
  return { ...previewOf(read), changes: read.hash === row.manifestHash ? [] : manifestChanges(row.manifest, read.manifest), granted_access: row.access }
}

/**
 * Applies the update that the Admin saw (`hash`). Only the keys that changed in the manifest change on the app, so an
 * Admin's own edit of another key stays. The granted access never goes up by itself: the Admin sends a higher one, at
 * most the new requested access. A lower requested access lowers the granted access.
 */
export async function applyManifestUpdate(db: Db, bucket: R2Bucket, principal: UserPrincipal, id: number, input: z.infer<typeof manifestApplyInput>): Promise<TicketAppView> {
  const row = await getRow(db, id)
  if (!row.manifestUrl || !row.manifest) throw notFromManifest()
  const read = await readManifest(row.manifestUrl)
  if (read.hash !== input.hash) throw manifestChanged()
  if (read.hash === row.manifestHash) return viewOf(db, id)
  const changes = manifestChanges(row.manifest, read.manifest)
  if (changes.some(c => c.warning) && !input.confirm_warnings) throw fail('confirm_warnings', 'Confirm the warnings first.')
  const { manifest, images } = read
  const access = input.access ?? (accessAbove(row.access, manifest.access) ? manifest.access : row.access)
  if (accessAbove(access, manifest.access)) throw accessNotRequested(manifest.access)

  const changed = new Set(changes.map(c => c.key))
  const next = { ...row, access }
  if (changed.has('name')) next.name = manifest.name
  if (changed.has('urls.sidebar')) next.sidebarUrl = manifest.urls.sidebar
  if (changed.has('urls.tab')) next.tabUrl = manifest.urls.tab
  if (changed.has('urls.page')) next.pageUrl = manifest.urls.page
  if (!next.sidebarUrl && !next.tabUrl && !next.pageUrl) throw noUrl()
  if (next.pageForRequesters && !next.pageUrl) throw noPageForRequesters()

  const puts: Partial<Record<AppIconMode, IconImage>> = {}
  if (changed.has('icons.light')) {
    next.iconLightType = images?.light.type ?? null
    if (images) puts.light = images.light
  }
  if (changed.has('icons.dark')) {
    next.iconDarkType = images?.dark?.type ?? null
    if (images?.dark) puts.dark = images.dark
  }
  // A dark image alone would show only in dark mode (issue 38).
  if (!next.iconLightType && next.iconDarkType) {
    next.iconDarkType = null
    delete puts.dark
  }
  const dropped = (['light', 'dark'] as const).filter(m => (m === 'light' ? row.iconLightType : row.iconDarkType) && !(m === 'light' ? next.iconLightType : next.iconDarkType))
  if (changed.has('icons.light') || changed.has('icons.dark')) next.iconVersion = row.iconVersion + 1

  const before = audited(row)
  const after = audited(next)
  const appKeys = (Object.keys(after) as (keyof typeof after)[]).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.map(k => [k, o[k]]))
  await putIconObjects(bucket, id, puts)
  await db.batch([
    db.update(ticketApp).set({
      name: next.name, sidebarUrl: next.sidebarUrl, tabUrl: next.tabUrl, pageUrl: next.pageUrl, access: next.access,
      iconLightType: next.iconLightType, iconDarkType: next.iconDarkType, iconVersion: next.iconVersion,
      manifestHash: read.hash, manifest,
    }).where(eq(ticketApp.id, id)),
    adminAuditEntry(db, principal, {
      subject: { type: 'ticket_app', id },
      action: 'ticket_app_changed',
      values: {
        before: { ...pick(before, appKeys), manifest_update: Object.fromEntries(changes.map(c => [c.key, c.before])) },
        after: { ...pick(after, appKeys), manifest_update: Object.fromEntries(changes.map(c => [c.key, c.after])) },
      },
    }),
  ])
  if (dropped.length) dropIconObjects(id, dropped)
  return viewOf(db, id)
}
