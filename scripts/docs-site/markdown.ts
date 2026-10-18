import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { Marked, type Token, type Tokens } from 'marked'
import { createHighlighter } from 'shiki'

/** Code languages the docs use. A block in another language fails the build, so it cannot show without colors. */
const LANGS = ['bash', 'js', 'ts', 'json', 'html', 'http', 'text'] as const
const LANG_ALIASES: Record<string, string> = { sh: 'bash', shell: 'bash', javascript: 'js', typescript: 'ts', '': 'text' }

export const REPO = 'https://github.com/Waterloo/Tikki/blob/main'

export interface Heading { depth: 2 | 3, text: string, id: string }

export type Highlighter = Awaited<ReturnType<typeof createHighlighter>>

export function loadHighlighter(): Promise<Highlighter> {
  return createHighlighter({ themes: ['github-light', 'github-dark'], langs: [...LANGS] })
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** GitHub's heading ids, so links written for GitHub (`#the-context`) work here too. */
export function slugger() {
  const seen = new Map<string, number>()
  return (text: string) => {
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n ? `${base}-${n}` : base
  }
}

/** Shiki HTML with both themes as CSS variables. A language outside LANGS fails the build. */
function highlight(hl: Highlighter, code: string, info: string): { lang: string, html: string } {
  const word = info.split(/\s/)[0] ?? ''
  const lang = LANG_ALIASES[word] ?? word
  if (!(LANGS as readonly string[]).includes(lang)) throw new Error(`Docs: code language "${word}" is not in LANGS (scripts/docs-site/markdown.ts).`)
  return { lang, html: hl.codeToHtml(code.replace(/\n$/, ''), { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false }) }
}

const copyButton = '<button type="button" class="copy" data-copy>Copy</button>'

/** One code block with a copy button. `info` is the fence's info string. */
export function codeBlock(hl: Highlighter, code: string, info: string): string {
  const { lang, html } = highlight(hl, code, info)
  return `<div class="code"><div class="code-head"><span>${lang === 'text' ? '' : lang}</span>${copyButton}</div>${html}</div>`
}

/** Code blocks side by side become tabs. Without JavaScript every panel shows, one after another. */
export function codeTabs(hl: Highlighter, blocks: { label: string, code: string, info: string }[]): string {
  const tabs = blocks.map((b, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${i}">${escapeHtml(b.label)}</button>`).join('')
  const panels = blocks.map((b, i) => `<div role="tabpanel" data-panel="${i}">${highlight(hl, b.code, b.info).html}</div>`).join('')
  return `<div class="code" data-tabs><div class="code-head"><div role="tablist">${tabs}</div>${copyButton}</div>${panels}</div>`
}

const TAB = /\btab=(?:"([^"]+)"|(\S+))/

/** Joins code blocks that follow each other and carry `tab=` into one tab group. */
function groupTabs(hl: Highlighter, tokens: Token[]): Token[] {
  const out: Token[] = []
  for (let i = 0; i < tokens.length; i++) {
    const group: Tokens.Code[] = []
    while (i < tokens.length) {
      const t = tokens[i]!
      if (t.type === 'code' && TAB.test((t as Tokens.Code).lang ?? '')) group.push(t as Tokens.Code)
      else if (!(t.type === 'space' && group.length)) break
      i++
    }
    if (group.length) {
      const blocks = group.map(c => { const m = TAB.exec(c.lang!)!; return { label: m[1] ?? m[2]!, code: c.text, info: c.lang! } })
      out.push({ type: 'html', block: true, pre: false, raw: '', text: codeTabs(hl, blocks), tabs: true } as Tokens.HTML)
    }
    if (i < tokens.length) out.push(tokens[i]!)
  }
  return out
}

export interface RenderOptions {
  /** The repository root, for images. */
  root: string
  /** The Markdown file's path from the repository root, for relative links. */
  file: string
  /** Docs file name → docs URL, for links between guides. */
  pages: Record<string, string>
}

export interface RenderedMarkdown { title: string, lead: string, html: string, headings: Heading[] }

/**
 * Renders one guide. The first `#` heading is the title and the paragraph after it is the lead; both go into the page
 * header, not the body.
 */
export function renderMarkdown(hl: Highlighter, source: string, opts: RenderOptions): RenderedMarkdown {
  const slug = slugger()
  const headings: Heading[] = []
  const marked = new Marked({ gfm: true })
  const dir = posix.dirname(opts.file)

  const href = (link: string) => {
    if (link.startsWith('#') || /^(https?|mailto):/i.test(link)) return link
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) throw new Error(`Docs: ${opts.file} links to "${link}". Only http, https and mailto links are allowed.`)
    const [path = '', hash] = link.split('#')
    const target = posix.normalize(posix.join(dir, path))
    const page = opts.pages[target]
    if (page) return page + (hash ? `#${hash}` : '')
    // Files that are not a docs page: the repository on GitHub. The test checks that each one exists.
    return `${REPO}/${target}${hash ? `#${hash}` : ''}`
  }

  marked.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens)
        const plain = text.replace(/`/g, '')
        const id = slug(plain)
        if (depth === 2 || depth === 3) headings.push({ depth, text: plain, id })
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`
      },
      code({ text, lang }) {
        return codeBlock(hl, text, lang ?? '')
      },
      link({ href: link, title, tokens }) {
        const url = href(link)
        const external = /^https?:/.test(url) && !url.startsWith('/')
        return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`
      },
      table(token) {
        const cell = (c: Tokens.TableCell, tag: 'th' | 'td') => `<${tag}${tag === 'th' ? ' scope="col"' : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`
        const head = `<tr>${token.header.map(c => cell(c, 'th')).join('')}</tr>`
        const rows = token.rows.map(r => `<tr>${r.map(c => cell(c, 'td')).join('')}</tr>`).join('')
        return `<div class="table" data-scroll-x><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`
      },
      blockquote({ tokens }) {
        let inner = this.parser.parse(tokens)
        let kind = 'note'
        inner = inner.replace(/^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/, (_, k: string) => {
          kind = k === 'WARNING' || k === 'CAUTION' ? 'warning' : 'note'
          return '<p>'
        })
        return `<div class="callout callout-${kind}" role="note">${inner}</div>\n`
      },
      // The guides are Markdown only, so a page cannot carry a script or a style by mistake. Tab groups are ours.
      html(token) {
        if ((token as Tokens.HTML & { tabs?: true }).tabs) return token.text
        throw new Error(`Docs: ${opts.file} has raw HTML: ${token.raw.trim().slice(0, 60)}`)
      },
      // An SVG goes inline: it then takes the page's colors and theme, and the page loads nothing more.
      image({ href: link, text }) {
        const target = posix.normalize(posix.join(dir, link))
        if (!/^docs\/assets\/[\w-]+\.svg$/.test(target)) throw new Error(`Docs: ${opts.file} shows "${link}". Only SVG files in docs/assets are allowed.`)
        const svg = readFileSync(join(opts.root, target), 'utf8').replace(/<\?xml[^>]*>\s*/, '')
        return `<figure class="diagram" data-scroll-x>${svg.replace('<svg ', `<svg role="img" aria-label="${escapeHtml(text)}" `)}</figure>`
      },
      // A paragraph that holds only an image is the figure, not a <p> around it.
      paragraph({ tokens }) {
        const inner = this.parser.parseInline(tokens)
        return tokens.length === 1 && tokens[0]!.type === 'image' ? `${inner}\n` : `<p>${inner}</p>\n`
      },
      checkbox({ checked }) {
        return `<input type="checkbox" disabled${checked ? ' checked' : ''} aria-hidden="true"> `
      },
    },
  })

  const tokens = marked.lexer(source)
  const h1 = tokens.findIndex(t => t.type === 'heading' && (t as Tokens.Heading).depth === 1)
  if (h1 === -1) throw new Error(`Docs: ${opts.file} has no "# " title.`)
  const title = (tokens[h1] as Tokens.Heading).text
  let after = tokens.slice(h1 + 1)
  // "## Contents" is for GitHub. The page has "On this page" instead.
  const contents = after.findIndex(t => t.type === 'heading' && (t as Tokens.Heading).text === 'Contents')
  if (contents !== -1) {
    const end = after.findIndex((t, i) => i > contents && t.type === 'heading')
    after = [...after.slice(0, contents), ...after.slice(end === -1 ? after.length : end)]
  }
  // The lead is the first paragraph before the first section, also when a note comes before it.
  const firstSection = after.findIndex(t => t.type === 'heading')
  const leadAt = after.findIndex((t, i) => t.type === 'paragraph' && (firstSection === -1 || i < firstSection))
  let lead = ''
  if (leadAt !== -1) {
    lead = marked.parseInline(after[leadAt]!.raw.trim()) as string
    after.splice(leadAt, 1)
  }
  const body = groupTabs(hl, after) as Token[] & { links: Record<string, never> }
  body.links = Object.create(null)
  const html = marked.parser(body)
  return { title, lead, html, headings }
}

/** Inline Markdown (backticks, links) in OpenAPI descriptions. */
export function inline(text: string): string {
  return new Marked().parseInline(text) as string
}
