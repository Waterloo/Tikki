import { expect, test, type Page } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

test.use({ storageState: { cookies: [], origins: [] } })

async function typeId(page: Page, prefix: string) {
  const { data } = await (await page.request.get('/api/v1/ticket-types')).json() as { data: { id: number, prefix: string }[] }
  return data.find(t => t.prefix === prefix)!.id
}

test('an Admin deletes a ticket, finds it in Settings › Privacy, and restores it', async ({ page }) => {
  await signInAsAdmin(page)
  const title = `Old printer ${Date.now()}`
  const res = await page.request.post('/api/v1/tickets', { data: { ticket_type_id: await typeId(page, 'GEN'), title } })
  expect(res.status()).toBe(201)
  const { ref } = await res.json() as { ref: string }

  await page.goto(`/tickets/${ref}`)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete ticket' }).click()
  await expect(page).toHaveURL(/\/tickets$/)
  await page.goto(`/tickets/${ref}`)
  await expect(page.getByText('No ticket with this reference')).toBeVisible()

  await page.goto('/settings')
  const row = page.getByRole('list', { name: 'Deleted tickets' }).getByRole('listitem').filter({ hasText: ref })
  await expect(row).toContainText(title)
  await row.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText(`${ref} restored`)).toBeVisible()
  await expect(row).toHaveCount(0)
  await page.goto(`/tickets/${ref}`)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
})

test('an Admin erases a Contact found by email in Settings › Privacy', async ({ page }) => {
  await signInAsAdmin(page)
  const gen = await typeId(page, 'GEN')
  const app = await (await page.request.post('/api/v1/applications', { data: { name: `Shop ${Date.now()}`, permissions: ['tickets:create', 'tickets:read'], ticket_type_ids: [gen] } })).json() as { id: number }
  const { key } = await (await page.request.post(`/api/v1/applications/${app.id}/keys`, { data: { name: 'Production' } })).json() as { key: string }
  const email = `erase${Date.now()}@shop.example`
  const created = await page.request.post('/api/v1/tickets', {
    data: { ticket_type_id: gen, title: 'Refund for my order', contact: { external_id: `cus_${Date.now()}`, name: 'Ana Lima', email } },
    headers: { authorization: `Bearer ${key}` },
  })
  expect(created.status()).toBe(201)
  const { ref } = await created.json() as { ref: string }

  await page.goto('/settings')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('button', { name: 'Find' }).click()
  const row = page.getByRole('list', { name: 'Contacts found' }).getByRole('listitem')
  await expect(row).toContainText('Ana Lima')
  await expect(row).toContainText('1 ticket')
  await row.getByRole('button', { name: 'Erase' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Erase', exact: true }).click()
  await expect(page.getByText('Personal data erased')).toBeVisible()

  const ticket = await (await page.request.get(`/api/v1/tickets/${ref}`)).json() as { title: string, requester: { name: string, email: string } }
  expect(ticket).toMatchObject({ title: '[erased]', requester: { name: '[erased]', email: '[erased]' } })

  // No horizontal page scroll on a phone.
  await page.setViewportSize({ width: 375, height: 800 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Deleted tickets' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
