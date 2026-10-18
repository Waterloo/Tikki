import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { APP_ICON_MAX_BYTES, APP_ICON_MODES, type AppIconMode, type AppIconType } from '../../shared/ticket-app-icons'
import { ticketApp } from '../db/schema'
import { adminAuditEntry } from './audit'
import type { Db } from './auth'
import { apiError } from './rest'
import { readLimited } from './settings'
import { dropIconObjects, getRow, iconKey, iconOf, invalid, listTicketApps, notFound, type TicketAppView } from './ticket-apps'
import type { UserPrincipal } from './tickets'

const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
// An optional BOM, XML prolog, comments and DOCTYPE may come before the root. The root must be `<svg`: an HTML file named .svg fails.
const SVG_START = /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?<svg[\s>]/i

/** The image type from the bytes. The file name and the request header are never trusted. */
export function iconTypeOf(bytes: Uint8Array): AppIconType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length >= PNG.length && PNG.every((b, i) => bytes[i] === b)) return 'image/png'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  // A prolog and a comment can be long; 1 KB is enough to find the root of a real icon.
  if (SVG_START.test(new TextDecoder().decode(bytes.subarray(0, 1024)))) return 'image/svg+xml'
  return null
}

const badImage = (reason: string) => invalid([{ key: 'image', reason }])

async function readIcon(request: Request): Promise<{ bytes: Uint8Array, type: AppIconType }> {
  const bytes = await readLimited(request, APP_ICON_MAX_BYTES, () => badImage('The image must be 256 KB or smaller.'))
  const type = iconTypeOf(bytes)
  if (!type) throw badImage('The image must be a PNG, WebP or SVG file.')
  return { bytes, type }
}

/** Stores an icon image: R2 first, then the row and its audit entry, so a row never points at a missing object. */
export async function setTicketAppIcon(db: Db, bucket: R2Bucket, principal: UserPrincipal, id: number, mode: AppIconMode, request: Request): Promise<TicketAppView> {
  const current = await getRow(db, id)
  const { bytes, type } = await readIcon(request)
  if (mode === 'dark' && !current.iconLightType) throw badImage('Upload the light image first. Without a dark image, the light one shows in dark mode.')
  await bucket.put(iconKey(id, mode), bytes, { httpMetadata: { contentType: type } })
  const next = { ...current, ...(mode === 'light' ? { iconLightType: type } : { iconDarkType: type }), iconVersion: current.iconVersion + 1 }
  await writeIcon(db, principal, current, next)
  return viewOf(db, id)
}

/** Removes one image. Removing the light image also removes the dark one: a dark image alone would show only in dark mode. */
export async function removeTicketAppIcon(db: Db, principal: UserPrincipal, id: number, mode: AppIconMode): Promise<TicketAppView> {
  const current = await getRow(db, id)
  const gone: AppIconMode[] = mode === 'light' ? ['light', 'dark'] : ['dark']
  const stored = gone.filter(m => (m === 'light' ? current.iconLightType : current.iconDarkType) !== null)
  if (stored.length) {
    const next = { ...current, iconVersion: current.iconVersion + 1, ...(mode === 'light' ? { iconLightType: null, iconDarkType: null } : { iconDarkType: null }) }
    await writeIcon(db, principal, current, next)
    dropIconObjects(id, stored)
  }
  return viewOf(db, id)
}

type IconRow = typeof ticketApp.$inferSelect

async function writeIcon(db: Db, principal: UserPrincipal, before: IconRow, after: IconRow): Promise<void> {
  await db.batch([
    db.update(ticketApp).set({ iconLightType: after.iconLightType, iconDarkType: after.iconDarkType, iconVersion: after.iconVersion }).where(eq(ticketApp.id, before.id)),
    adminAuditEntry(db, principal, { subject: { type: 'ticket_app', id: before.id }, action: 'ticket_app_changed', values: { before: { icon: iconOf(before) }, after: { icon: iconOf(after) } } }),
  ])
}

async function viewOf(db: Db, id: number): Promise<TicketAppView> {
  const view = (await listTicketApps(db)).find(a => a.id === id)
  if (!view) throw notFound()
  return view
}

/**
 * The stored image for a mode, or null. A missing dark image answers the light one. The caller checked the policy.
 * Same headers as the organization logo, except `private`: the route needs a session.
 */
export async function readTicketAppIcon(db: Db, bucket: R2Bucket, id: number, mode: AppIconMode): Promise<Response | null> {
  const [row] = await db.select({ light: ticketApp.iconLightType, dark: ticketApp.iconDarkType }).from(ticketApp).where(eq(ticketApp.id, id)).limit(1)
  if (!row?.light) return null
  const served: AppIconMode = mode === 'dark' && row.dark ? 'dark' : 'light'
  const object = await bucket.get(iconKey(id, served))
  if (!object) throw new Error(`Ticket App ${id} has a ${served} icon record but no object in the bucket.`)
  return new Response(object.body, {
    headers: {
      // The type of the object, so bytes and type always match, even if a row update failed after the put.
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-length': String(object.size),
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'default-src \'none\'; sandbox',
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}

/** `?mode=light|dark`, or 422. Without `fallback` the mode is required. */
export function iconModeParam(event: H3Event, fallback?: AppIconMode): AppIconMode | Response {
  const mode = getQuery(event).mode ?? fallback
  if (typeof mode === 'string' && (APP_ICON_MODES as readonly string[]).includes(mode)) return mode as AppIconMode
  return apiError(422, 'VALIDATION_FAILED', 'The request has invalid values.', [{ key: 'mode', reason: 'Must be light or dark.' }])
}
