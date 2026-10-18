import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { ADMIN_STATE } from './sign-in'
import { appUrl, TIKKI_ORIGIN } from './ticket-app'

const WIDTHS = [375, 1100, 1280, 1440]

/** Runs in the page. Returns the interactive elements that are cut off by the viewport or by an ancestor. */
function findClipped() {
  const out: { name: string, tag: string, reason: string }[] = []
  const selector = 'button, a[href], input, select, textarea, [role=button], [role=combobox]'
  const slack = 1
  elements: for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = el.getBoundingClientRect()
    // Under 2 px: visually hidden helpers such as sr-only links and file inputs.
    if (rect.width < 2 || rect.height < 2 || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue
    if (el.closest('[aria-hidden="true"], [inert]')) continue
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLInputElement).placeholder
      || el.innerText || el.textContent || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 50)
    const base = { name, tag: el.tagName.toLowerCase() }
    let inside = rect
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX
      if (ox === 'visible') continue
      const box = a.getBoundingClientRect()
      // A sideways scroll area that the author asked for (a wide table in a card) lets the element be reached by
      // scrolling, so only the area itself must fit. Computed style cannot tell it apart: `overflow-y: auto` on a page
      // panel also computes `overflow-x: auto`. So only the authored classes or `data-scroll-x` count; any other box
      // that clips sideways cuts the element off.
      const sideways = /(^|\s)overflow-(x-)?(auto|scroll)(\s|$)/.test(String(a.className)) || a.hasAttribute('data-scroll-x')
      if ((ox === 'auto' || ox === 'scroll') && sideways) { inside = box; break }
      if (rect.left < box.left - slack || rect.right > box.right + slack) {
        out.push({ ...base, reason: `clipped by <${a.tagName.toLowerCase()} class="${String(a.className).slice(0, 60)}"> (${Math.round(rect.left)}..${Math.round(rect.right)} in ${Math.round(box.left)}..${Math.round(box.right)})` })
        break
      }
    }
    if (inside.left < -slack || inside.right > innerWidth + slack) {
      out.push({ ...base, reason: `outside viewport (${Math.round(inside.left)}..${Math.round(inside.right)} of ${innerWidth})` })
    }
  }
  return out
}

interface Seed { ref: string, typeId: number, appId: number, ticketAppIds: number[] }
let seeded: Promise<Seed> | undefined

// Once for both color schemes. The page needs data that makes every panel and the widest action set show.
function seed(context: BrowserContext): Promise<Seed> {
  seeded ??= (async () => {
    const api = context.request
    const ok = async (res: Awaited<ReturnType<typeof api.get>>) => {
      expect(res.ok(), await res.text()).toBe(true)
      return res.json()
    }
    const stamp = Date.now()
    const me = await ok(await api.get('/api/auth/get-session')) as { user: { id: string } }
    const types = (await ok(await api.get('/api/v1/ticket-types'))).data as { id: number, name: string }[]
    const bug = types.find(t => t.name === 'Bug')!
    const ticket = await ok(await api.post('/api/v1/tickets', {
      data: { ticket_type_id: bug.id, title: `Layout check ${stamp}`, fields: { page_or_feature: 'Checkout' } },
    })) as { ref: string }
    await ok(await api.patch(`/api/v1/tickets/${ticket.ref}`, { data: { assignee_id: me.user.id } }))
    await ok(await api.post(`/api/v1/tickets/${ticket.ref}/comments`, { data: { body: 'A public comment for the layout check.' } }))
    await ok(await api.post('/api/v1/invites', { data: { emails: [`layout-${stamp}@northwind.test`], role: 'agent' } }))
    const app = await ok(await api.post('/api/v1/applications', {
      data: { name: `Layout app ${stamp}`, description: 'layout', permissions: ['tickets:create', 'tickets:read'], ticket_type_ids: [bug.id] },
    })) as { id: number }
    await ok(await api.post('/api/v1/webhooks', { data: { name: `Layout hook ${stamp}`, url: 'http://localhost/nowhere' } }))
    // One app with a sidebar card, a tab and a page (issues 34, 37, 39), on Bug tickets only.
    const both = await ok(await api.post('/api/v1/admin/ticket-apps', { data: { name: 'Orders', sidebar_url: appUrl(TIKKI_ORIGIN), tab_url: appUrl(TIKKI_ORIGIN), page_url: appUrl(TIKKI_ORIGIN), ticket_type_ids: [bug.id] } })) as { id: number }
    return { ref: ticket.ref, typeId: bug.id, appId: app.id, ticketAppIds: [both.id] }
  })()
  return seeded
}

const PAGES: [string, (s: Seed) => string][] = [
  ['My tickets', () => '/'],
  ['All tickets', () => '/tickets'],
  ['Ticket', s => `/tickets/${s.ref}`],
  ['Ticket, app tab', s => `/tickets/${s.ref}?tab=app-${s.ticketAppIds[0]}`],
  ['New ticket', () => '/tickets/new'],
  ['Inbox', () => '/inbox'],
  ['Types and fields', () => '/admin/types'],
  ['Type editor', s => `/admin/types/${s.typeId}`],
  ['Teams and users', () => '/people'],
  ['Applications', () => '/applications'],
  ['Application', s => `/applications/${s.appId}`],
  ['Webhooks', () => '/webhooks'],
  ['Ticket Apps', () => '/admin/apps'],
  ['App page', s => `/apps/${s.ticketAppIds[0]}`],
  ['Settings', () => '/settings'],
]

async function check(page: Page, name: string, path: string) {
  const problems: string[] = []
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    const r = await page.evaluate(`(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: innerWidth,
      sheets: document.querySelectorAll('link[rel=stylesheet][href*="entry."]').length,
      clipped: (${findClipped.toString()})(),
    }))()`) as { scroll: number, inner: number, sheets: number, clipped: ReturnType<typeof findClipped> }
    if (r.scroll > r.inner) problems.push(`${name} @${width}: horizontal scroll (${r.scroll} > ${r.inner})`)
    if (r.sheets !== 1) problems.push(`${name} @${width}: ${r.sheets} entry stylesheets`)
    for (const c of r.clipped) problems.push(`${name} @${width}: ${c.tag} "${c.name}" ${c.reason}`)
  }
  expect(problems).toEqual([])
}

// Apps show on every Bug ticket, so none stays for the other specs.
test.afterAll(async ({ playwright, baseURL }) => {
  if (!seeded) return
  const api = await playwright.request.newContext({ baseURL, storageState: ADMIN_STATE })
  for (const id of (await seeded).ticketAppIds) await api.delete(`/api/v1/admin/ticket-apps/${id}`)
  await api.dispose()
})

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`layout, ${colorScheme}`, () => {
    let context: BrowserContext
    let page: Page
    test.beforeAll(async ({ browser }: { browser: Browser }) => {
      context = await browser.newContext({ storageState: ADMIN_STATE, colorScheme, viewport: { width: 1280, height: 900 } })
      page = await context.newPage()
      await seed(context)
    })
    test.afterAll(async () => { await context.close() })

    for (const [name, path] of PAGES) {
      test(name, async () => {
        await check(page, name, path(await seed(context)))
      })
    }
  })
}
