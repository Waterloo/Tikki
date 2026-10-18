import { expect, test, type Page } from '@playwright/test'
import { ADMIN_STATE } from './sign-in'

// The developer docs are static files from the build (scripts/docs-site), served by Workers static assets.
const PAGES = ['/docs/', '/docs/ticket-apps', '/docs/ticket-apps-reference', '/docs/webhooks', '/docs/ai', '/docs/api']

// Public: no session.
test.use({ storageState: { cookies: [], origins: [] } })

test('every docs page is public and cannot be framed', async ({ request }) => {
  for (const path of PAGES) {
    const res = await request.get(path, { maxRedirects: 0 })
    expect(res.status(), path).toBe(200)
    expect(res.headers()['content-type'], path).toContain('text/html')
    expect(res.headers()['content-security-policy'], path).toBe("frame-ancestors 'none'")
    expect(res.headers()['x-frame-options'], path).toBe('DENY')
  }
  const md = await request.get('/docs/ticket-apps.md')
  expect(await md.text()).toContain('# Build a Ticket App')
})

test('the old guide address redirects to the docs', async ({ request }) => {
  const res = await request.get('/api/docs/ticket-apps.md', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  expect(res.headers().location).toBe('/docs/ticket-apps.md')
})

test('examples show the address of this instance, and copy gives it too', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/docs/api')
  const origin = new URL(baseURL!).origin
  const text = await page.locator('main').textContent()
  expect(text).toContain(`${origin}/api/v1/tickets`)
  expect(text).not.toContain('tikki.example.com')

  const block = page.locator('.operation').filter({ has: page.locator('#create-ticket') }).locator('[data-tabs]').first()
  await block.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(block.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`curl -X POST ${origin}/api/v1/tickets`)
})

test('a language tab holds for every block and the next visit', async ({ page }) => {
  await page.goto('/docs/api')
  const first = page.locator('[data-tabs]').first()
  await expect(first.getByRole('tabpanel').filter({ hasText: 'curl' })).toBeVisible()
  await first.getByRole('tab', { name: 'JavaScript', exact: true }).click()
  await expect(first.getByRole('tab', { name: 'JavaScript', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(first.getByRole('tabpanel').filter({ hasText: 'await fetch' })).toBeVisible()
  await expect(first.getByRole('tabpanel').filter({ hasText: 'curl' })).toBeHidden()

  await page.reload()
  await expect(page.locator('.operation-samples > [data-tabs]').last().getByRole('tab', { name: 'JavaScript', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('search finds a section on another page and opens it', async ({ page }) => {
  await page.goto('/docs/')
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: 'Search the docs' })
  await dialog.getByRole('searchbox').fill('verify signature')
  const first = dialog.getByRole('option').first()
  await expect(first).toContainText('Verify the signature')
  await dialog.getByRole('searchbox').press('Enter')
  await expect(page).toHaveURL(/\/docs\/webhooks#verify-the-signature$/)

  await page.keyboard.press('/')
  await dialog.getByRole('searchbox').fill('zzzqqq')
  await expect(dialog.getByText('No result for "zzzqqq"')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the How it works figure steps through the numbered list', async ({ page }) => {
  await page.goto('/docs/ticket-apps')
  const svg = page.locator('svg.tkd')
  const play = page.locator('figure:has(svg.tkd) + .diagram-play')
  const steps = page.locator('figure:has(svg.tkd) + .diagram-play + ol > li')
  await expect(svg).toHaveAttribute('role', 'img')
  await expect(svg).not.toHaveAttribute('data-step')
  await play.click()
  await expect(svg).toHaveAttribute('data-step', '1')
  await expect(steps.nth(0)).toHaveClass(/step-on/)
  await expect(svg).toHaveAttribute('data-step', '2', { timeout: 3000 })
  await expect(play).toHaveAccessibleName('Stop')
  await play.click()
  await expect(svg).not.toHaveAttribute('data-step')

  await steps.nth(2).hover()
  await expect(svg).toHaveAttribute('data-step', '3')
  await expect(steps.nth(2)).toHaveClass(/step-on/)
})

test('every step-through figure gets its Play button and its list', async ({ page }) => {
  await page.goto('/docs/ticket-apps')
  const figures = page.locator('figure.diagram svg[data-steps]')
  await expect(figures).toHaveCount(4)
  await expect(page.getByRole('img', { name: /A Tikki app page/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play the steps' })).toHaveCount(4)
  for (const cls of ['tkp', 'tkd', 'tkr', 'tkm']) {
    const steps = Number(await page.locator(`svg.${cls}`).getAttribute('data-steps'))
    await expect(page.locator(`figure:has(svg.${cls}) + .diagram-play + ol > li`), cls).toHaveCount(steps)
  }
  const reach = page.locator('svg.tkr')
  await page.locator('figure:has(svg.tkr) + .diagram-play + ol > li').nth(1).hover()
  await expect(reach).toHaveAttribute('data-step', '2')
  await expect(reach).toHaveClass(/no-packet/)
})

test('the theme switch holds, with the same key as the web app', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/docs/webhooks')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Switch light or dark mode' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  expect(await page.evaluate(() => localStorage.getItem('nuxt-color-mode'))).toBe('dark')
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

async function noSidewaysScroll(page: Page, label: string) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
  expect(scroll, label).toBeLessThanOrEqual(width)
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [375, 1440]) {
    test(`every docs page fits ${width} px in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width, height: 900 })
      for (const path of PAGES) {
        await page.goto(path)
        await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /dark/ : /^(?!.*dark)/)
        await noSidewaysScroll(page, `${path} at ${width}`)
      }
    })
  }
}

test('the home page has no sidebar on a desktop; the guides do', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/docs/')
  await expect(page.getByRole('navigation', { name: 'Docs' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Build on Tikki' })).toBeVisible()
  await page.goto('/docs/webhooks')
  await expect(page.getByRole('navigation', { name: 'Docs' })).toBeVisible()
})

test('at 375 px the menu opens, and a link closes it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/docs/ticket-apps')
  const nav = page.getByRole('navigation', { name: 'Docs' })
  await expect(nav).toBeHidden()
  await page.getByRole('button', { name: 'Open the menu' }).click()
  await expect(nav).toBeVisible()
  await nav.getByRole('link', { name: 'Webhooks', exact: true }).click()
  await expect(page).toHaveURL(/\/docs\/webhooks$/)
  await expect(nav).toBeHidden()
})

test.describe('links from the app', () => {
  test.use({ storageState: ADMIN_STATE })

  test('Webhooks, Applications, Ticket Apps and Settings link to the docs', async ({ page }) => {
    await page.goto('/webhooks')
    await expect(page.getByRole('link', { name: 'Developer docs', exact: true })).toHaveAttribute('href', '/docs/webhooks')
    await page.goto('/applications')
    await expect(page.getByRole('link', { name: 'Developer docs', exact: true })).toHaveAttribute('href', '/docs/api')
    await page.goto('/admin/apps')
    await expect(page.getByRole('link', { name: 'Read the developer guide' })).toHaveAttribute('href', '/docs/ticket-apps')
    await page.goto('/settings')
    await expect(page.getByRole('link', { name: 'Developer docs', exact: true })).toHaveAttribute('href', '/docs/')
  })
})
