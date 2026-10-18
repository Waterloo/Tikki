import { escapeHtml, REPO, type Heading } from './markdown'

export interface NavItem { label: string, href: string, badge?: string, external?: boolean }
export interface NavGroup { title: string, items: NavItem[] }

export interface PageInput {
  /** The URL path, for example `/docs/webhooks`. */
  path: string
  title: string
  description: string
  /** Inline HTML. */
  lead: string
  body: string
  headings: Heading[]
  nav: NavGroup[]
  /** The Markdown or code the page is built from, from the repository root. */
  source: string
  /** The raw Markdown of the page, if there is one. */
  markdown?: string
  /** `wide`: no "On this page" column, for the API reference. */
  wide?: boolean
  home?: boolean
  prev?: NavItem
  next?: NavItem
}

const icon = (d: string, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
}

// Before the first paint, so a dark page never flashes white. Same storage key as the web app (@nuxtjs/color-mode).
const THEME_SCRIPT = `try{var m=localStorage.getItem('nuxt-color-mode');if(m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`

function navHtml(nav: NavGroup[], path: string): string {
  return nav.map(g => `<p class="nav-title">${escapeHtml(g.title)}</p><ul>${g.items.map((i) => {
    const current = i.href === path
    return `<li><a href="${i.href}"${current ? ' aria-current="page"' : ''}${i.external ? ' target="_blank" rel="noopener"' : ''}>${i.badge ?? ''}<span>${escapeHtml(i.label)}</span>${i.external ? '<span class="ext" aria-hidden="true">↗</span>' : ''}</a></li>`
  }).join('')}</ul>`).join('')
}

function tocHtml(headings: Heading[]): string {
  return headings.map(h => `<li class="toc-${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')
}

export function renderPage(p: PageInput, mark: string): string {
  const toc = !p.wide && !p.home && p.headings.length
    ? tocHtml(p.headings) : ''
  const actions = p.markdown
    ? `<div class="page-actions"><button type="button" class="btn" data-copy-page="${p.markdown}">${icon(ICONS.copy, 14)}<span>Copy page as Markdown</span></button><a class="btn" href="${p.markdown}">View as Markdown</a></div>`
    : ''
  const pager = p.prev || p.next
    ? `<nav class="pager" aria-label="Previous and next">${p.prev ? `<a href="${p.prev.href}"><span>Previous</span>${escapeHtml(p.prev.label)}</a>` : '<span></span>'}${p.next ? `<a class="next" href="${p.next.href}"><span>Next</span>${escapeHtml(p.next.label)}</a>` : ''}</nav>`
    : ''
  const header = p.home ? '' : `<header class="page-head">
<h1>${escapeHtml(p.title)}</h1>
${p.lead ? `<p class="lead">${p.lead}</p>` : ''}
${actions}
</header>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.home ? 'Tikki developer docs' : `${p.title} · Tikki docs`)}</title>
<meta name="description" content="${escapeHtml(p.description)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preload" href="/docs/assets/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/docs/assets/docs.css">
<script>${THEME_SCRIPT}</script>
<script src="/docs/assets/docs.js" defer></script>
</head>
<body${p.wide ? ' class="wide"' : p.home ? ' class="home-page"' : ''}>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<button type="button" class="icon-btn menu-btn" aria-label="Open the menu" aria-expanded="false" aria-controls="docs-nav" data-menu>${icon(ICONS.menu, 20)}</button>
<a class="brand" href="/docs/">${mark}<span class="word">tikki</span><span class="docs">Docs</span></a>
<button type="button" class="search-btn" data-search-open>${icon(ICONS.search)}<span class="label">Search the docs</span><kbd>⌘K</kbd></button>
<nav class="top-nav" aria-label="Main"><a href="/docs/ticket-apps">Guides</a><a href="/docs/api">API reference</a><a href="/">Open Tikki</a></nav>
<button type="button" class="icon-btn search-icon" aria-label="Search the docs" data-search-open>${icon(ICONS.search, 19)}</button>
<button type="button" class="icon-btn" aria-label="Switch light or dark mode" data-theme><span class="if-light">${icon(ICONS.moon, 17)}</span><span class="if-dark">${icon(ICONS.sun, 17)}</span></button>
</header>
<div class="shell">
<nav id="docs-nav" class="sidebar" aria-label="Docs">${navHtml(p.nav, p.path)}</nav>
<main id="main" class="${p.home ? 'home' : 'page'}">
<article class="content">
${toc ? `<details class="toc-mobile"><summary>On this page ${icon(ICONS.chevron)}</summary><ul>${toc}</ul></details>` : ''}
${header}
<div class="prose">
${p.body}
</div>
${pager}
${p.home ? '' : `<p class="source">Built from <a href="${REPO}/${p.source}" rel="noopener"><code>${escapeHtml(p.source)}</code></a> with each deploy.</p>`}
</article>
${toc ? `<aside class="toc" aria-label="On this page"><p>On this page</p><ul>${toc}</ul></aside>` : ''}
</main>
</div>
<dialog class="search" aria-label="Search the docs">
<form method="dialog" class="search-box" role="search">
<label>${icon(ICONS.search, 18)}<span class="sr-only">Search</span><input type="search" name="q" autocomplete="off" placeholder="Search the docs" aria-controls="search-results"></label>
<button type="submit" class="esc" aria-label="Close search">esc</button>
</form>
<ul id="search-results" class="search-results" role="listbox" aria-label="Results"></ul>
<p class="search-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span class="count" aria-live="polite"></span></p>
</dialog>
</body>
</html>
`
}
