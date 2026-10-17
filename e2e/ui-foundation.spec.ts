import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 375, height: 812 } })

const scrollWidth = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth)

test('at 375 px there is no horizontal scroll and the menu button opens the navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My tickets' }).first()).toBeVisible()
  expect(await scrollWidth(page)).toBeLessThanOrEqual(375)

  await page.getByRole('button', { name: 'Open sidebar' }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'New ticket' })).toBeVisible()
})

test('a long ticket title is cut with an ellipsis', async ({ page }) => {
  const title = `E2E ${'very long title '.repeat(8)}`.trim()
  const types = await page.request.get('/api/v1/ticket-types')
  const general = (await types.json()).data.find((t: { name: string }) => t.name === 'General request')
  const created = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: general.id, title } })
  expect(created.ok()).toBe(true)

  await page.goto('/')
  const cell = page.getByTitle(title)
  await expect(cell).toBeVisible()
  const cut = await cell.evaluate(el => ({
    overflow: getComputedStyle(el).textOverflow,
    clipped: el.scrollWidth > el.clientWidth,
  }))
  expect(cut).toEqual({ overflow: 'ellipsis', clipped: true })
  expect(await scrollWidth(page)).toBeLessThanOrEqual(375)
})
