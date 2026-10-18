import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { escapeHtml } from './markdown'

/**
 * Open Graph images (1200×630 PNG) for the docs pages, made at build time. The card is an SVG string, drawn in the
 * brand look of docs/assets/readme-cover.png, and resvg turns it into a PNG with the Geist fonts. No Worker CPU.
 */

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

const CREAM = '#FFF4E6'
const YELLOW = '#FFC94D'
const INK = '#2B2A33'
const MUTED = '#5E5A66'

const FONTS = [
  'geist-sans/Geist-Regular.ttf', 'geist-sans/Geist-Medium.ttf', 'geist-sans/Geist-SemiBold.ttf', 'geist-sans/Geist-Bold.ttf',
  'geist-mono/GeistMono-Regular.ttf',
]

export interface OgCard {
  title: string
  description: string
  /** The page address without the scheme, shown above the edge. Left out when the site URL is not known. */
  address?: string
}

/**
 * Breaks text into at most `lines` lines of about `width` characters, at spaces. Geist has no fixed width, so the
 * limits leave room; the last line ends with "…" when text is cut.
 */
export function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = []
  let line = ''
  const words = text.split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]!
    if (next.length <= width) { line = next; continue }
    if (line) out.push(line)
    line = words[i]!
    if (out.length === lines) return cut(out)
  }
  if (line) out.push(line)
  return out.length > lines ? cut(out.slice(0, lines)) : out
}
const cut = (out: string[]) => [...out.slice(0, -1), `${out.at(-1)!.replace(/[\s,.;:]*$/, '')}…`]

/** The scalloped yellow edge of the README cover: a band, and half circles of radius 16 every 32 px under it. */
function edge(): string {
  const r = 16
  const top = OG_HEIGHT - 44
  const circles = Array.from({ length: Math.ceil(OG_WIDTH / (2 * r)) + 1 }, (_, i) => `<circle cx="${r + i * 2 * r}" cy="${OG_HEIGHT - r}" r="${r}"/>`).join('')
  return `<g fill="${YELLOW}"><rect x="0" y="${top}" width="${OG_WIDTH}" height="${44 - r}"/>${circles}</g>`
}

export function ogSvg(card: OgCard, lockupPng: Buffer): string {
  const title = wrap(card.title, 22, 2)
  const titleSize = title.length > 1 || card.title.length > 16 ? 84 : 104
  const titleTop = 270
  const titleLines = title.map((t, i) => `<tspan x="80" y="${titleTop + i * titleSize * 1.08}">${escapeHtml(t)}</tspan>`).join('')
  const descTop = titleTop + (title.length - 1) * titleSize * 1.08 + 72
  const desc = wrap(card.description, 62, 3).map((t, i) => `<tspan x="80" y="${descTop + i * 44}">${escapeHtml(t)}</tspan>`).join('')
  // The lockup PNG has the mascot and the "tikki" wordmark on the cream ground; the inner viewBox crops its margin.
  const lockup = `data:image/png;base64,${lockupPng.toString('base64')}`
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${CREAM}"/>
<svg x="72" y="60" width="244" height="72" viewBox="340 184 620 183"><image width="1280" height="560" xlink:href="${lockup}"/></svg>
<rect x="336" y="74" width="3" height="44" rx="1.5" fill="${INK}" opacity="0.18"/>
<text x="358" y="113" font-family="Geist" font-weight="500" font-size="40" fill="${MUTED}">Docs</text>
<text font-family="Geist" font-weight="700" font-size="${titleSize}" letter-spacing="-2" fill="${INK}">${titleLines}</text>
<text font-family="Geist" font-weight="400" font-size="32" fill="${MUTED}">${desc}</text>
${card.address ? `<text x="80" y="${OG_HEIGHT - 76}" font-family="Geist Mono" font-size="24" fill="${MUTED}">${escapeHtml(card.address)}</text>` : ''}
${edge()}
</svg>`
}

export function renderOg(root: string, card: OgCard): Buffer {
  const lockup = readFileSync(join(root, 'docs/assets/tikki-lockup.png'))
  const fontFiles = FONTS.map(f => join(root, 'node_modules/geist/dist/fonts', f))
  const png = new Resvg(ogSvg(card, lockup), { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Geist' } }).render().asPng()
  return Buffer.from(png)
}
