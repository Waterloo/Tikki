// The developer docs: tabs, copy, search, theme, menu. The pages read without it (docs/writing-docs.md).
(() => {
  const EXAMPLE_ORIGIN = 'https://tikki.example.com'
  const root = document.documentElement
  root.classList.add('js')
  const store = {
    get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
    set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode: the choice lasts for this page only */ } },
  }

  // Examples show this instance, so a copied command works as it is.
  const origin = /^https?:$/.test(location.protocol) ? location.origin : EXAMPLE_ORIGIN
  const withOrigin = text => text.split(EXAMPLE_ORIGIN).join(origin)
  if (origin !== EXAMPLE_ORIGIN) {
    const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.includes(EXAMPLE_ORIGIN)) n.data = withOrigin(n.data)
  }

  // Theme: the same key as the web app, so one choice holds for both.
  document.querySelector('[data-theme]')?.addEventListener('click', () => {
    const dark = root.classList.toggle('dark')
    store.set('nuxt-color-mode', dark ? 'dark' : 'light')
  })

  // Tabs. A choice of language holds for every block and the next visit.
  const tabGroups = [...document.querySelectorAll('[data-tabs]')]
  const select = (group, label) => {
    const tabs = [...group.querySelectorAll('[role="tab"]')]
    const i = tabs.findIndex(t => t.textContent === label)
    if (i === -1) return
    tabs.forEach((t, j) => t.setAttribute('aria-selected', String(i === j)))
    group.querySelectorAll('[role="tabpanel"]').forEach((p, j) => { p.hidden = i !== j })
  }
  for (const group of tabGroups) {
    select(group, group.querySelector('[role="tab"]').textContent)
    group.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]')
      if (!tab) return
      const label = tab.textContent
      // Status tabs (201, 422) belong to one response, so only language choices are shared.
      if (/^\d{3}$/.test(label)) return select(group, label)
      store.set('docs-tab', label)
      tabGroups.forEach(g => select(g, label))
    })
  }
  const saved = store.get('docs-tab')
  if (saved) tabGroups.forEach(g => select(g, saved))

  const flash = (button, text) => {
    const label = button.querySelector('span') ?? button
    const before = label.textContent
    label.textContent = text
    setTimeout(() => { label.textContent = before }, 1500)
  }
  const copy = async (button, text) => {
    try {
      await navigator.clipboard.writeText(text)
      flash(button, 'Copied')
    } catch {
      flash(button, 'Copy failed')
    }
  }
  document.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-copy]')
    if (button) {
      const block = button.closest('.code')
      const pre = [...block.querySelectorAll('pre')].find(p => !p.closest('[hidden]'))
      return copy(button, pre.textContent)
    }
    const page = e.target.closest('[data-copy-page]')
    if (page) {
      const res = await fetch(page.dataset.copyPage)
      if (!res.ok) return flash(page, 'Copy failed')
      return copy(page, withOrigin(await res.text()))
    }
  })

  // Menu on narrow screens.
  const menu = document.querySelector('[data-menu]')
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open)
    menu?.setAttribute('aria-expanded', String(open))
    menu?.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu')
  }
  menu?.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')))
  document.getElementById('docs-nav')?.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false) })

  // "On this page": the section at the top of the screen.
  const tocLinks = [...document.querySelectorAll('.toc a')]
  const sections = tocLinks.map(a => document.getElementById(a.hash.slice(1))).filter(Boolean)
  if (sections.length) {
    let queued = false
    const mark = () => {
      queued = false
      let current = sections[0]
      for (const s of sections) if (s.getBoundingClientRect().top < 120) current = s
      tocLinks.forEach(a => a.setAttribute('aria-current', String(a.hash === `#${current.id}`)))
    }
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(mark) } }, { passive: true })
    mark()
  }

  // Search over the sections of every page (search.json, made by the build).
  const dialog = document.querySelector('dialog.search')
  const input = dialog.querySelector('input')
  const list = dialog.querySelector('.search-results')
  const count = dialog.querySelector('.count')
  let index
  let results = []
  let active = 0

  const open = async () => {
    if (!dialog.open) dialog.showModal()
    input.select()
    index ??= fetch('/docs/search.json').then((r) => {
      if (!r.ok) throw new Error(`search.json: ${r.status}`)
      return r.json()
    })
    render()
  }
  document.querySelectorAll('[data-search-open]').forEach(b => b.addEventListener('click', open))
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
      e.preventDefault()
      open()
    }
  })
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close() })

  const words = q => q.toLowerCase().split(/\s+/).filter(Boolean)
  function highlight(el, text, terms) {
    const lower = text.toLowerCase()
    let at = 0
    while (at < text.length) {
      let next = -1
      let len = 0
      for (const t of terms) {
        const i = lower.indexOf(t, at)
        if (i !== -1 && (next === -1 || i < next)) { next = i; len = t.length }
      }
      if (next === -1) break
      el.append(text.slice(at, next))
      const m = document.createElement('mark')
      m.textContent = text.slice(next, next + len)
      el.append(m)
      at = next + len
    }
    el.append(text.slice(at))
  }
  function snippet(text, terms) {
    const lower = text.toLowerCase()
    const first = Math.min(...terms.map(t => lower.indexOf(t)).filter(i => i !== -1))
    const from = Number.isFinite(first) ? Math.max(0, first - 40) : 0
    return (from ? '…' : '') + text.slice(from, from + 160)
  }
  async function render() {
    const terms = words(input.value)
    let entries = []
    if (terms.length) {
      try {
        entries = await index
      } catch {
        index = undefined
        list.replaceChildren(Object.assign(document.createElement('li'), { className: 'search-empty', textContent: 'Search could not load. Check your connection, then type again.' }))
        return
      }
    }
    // A later keystroke may have rendered while this one waited.
    if (words(input.value).join(' ') !== terms.join(' ')) return
    list.replaceChildren()
    if (!terms.length) { count.textContent = ''; results = []; return }
    results = entries.map((e) => {
      const title = e.title.toLowerCase()
      const text = e.text.toLowerCase()
      if (!terms.every(t => title.includes(t) || text.includes(t) || e.page.toLowerCase().includes(t))) return null
      const score = terms.reduce((s, t) => s + (title.includes(t) ? 10 : 0) + (text.split(t).length - 1), 0)
      return { ...e, score }
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8)
    active = 0
    count.textContent = results.length ? `${results.length} result${results.length > 1 ? 's' : ''}` : ''
    if (!results.length) {
      const li = document.createElement('li')
      li.className = 'search-empty'
      li.textContent = `No result for "${input.value}". Try a shorter word, or a code such as tikki:resize.`
      list.append(li)
      return
    }
    results.forEach((r, i) => {
      const li = document.createElement('li')
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(i === active))
      const a = document.createElement('a')
      a.href = r.url
      const page = document.createElement('span')
      page.className = 'r-page'
      page.textContent = r.page
      const title = document.createElement('span')
      title.className = 'r-title'
      highlight(title, r.title, terms)
      const text = document.createElement('span')
      text.className = 'r-text'
      highlight(text, withOrigin(snippet(r.text, terms)), terms)
      a.append(page, title, text)
      a.addEventListener('click', () => dialog.close())
      li.append(a)
      list.append(li)
    })
  }
  const move = (to) => {
    const items = [...list.querySelectorAll('[role="option"]')]
    if (!items.length) return
    active = (to + items.length) % items.length
    items.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)))
    items[active].scrollIntoView({ block: 'nearest' })
  }
  input.addEventListener('input', render)
  input.addEventListener('keydown', (e) => {
    // In a search field the browser's first Escape only clears the text.
    if (e.key === 'Escape') { e.preventDefault(); dialog.close() }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(active + 1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(active - 1) }
    if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[active]
      if (r) { dialog.close(); location.href = r.url }
    }
  })
})()
