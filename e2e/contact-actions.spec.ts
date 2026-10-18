import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './sign-in'

test('the Admin sees an Application comment and cancel as "Contact · <Application>"', async ({ page, request }) => {
  await signInAsAdmin(page)
  const types = await page.request.get('/api/v1/ticket-types')
  const general = (await types.json()).data.find((t: { name: string }) => t.name === 'General request')
  const name = `Contact app ${Date.now()}`
  const appRes = await page.request.post('/api/v1/applications', { data: { name, description: 'e2e', permissions: ['tickets:create', 'tickets:read', 'tickets:update', 'comments:create'], ticket_type_ids: [general.id] } })
  expect(appRes.status(), await appRes.text()).toBe(201)
  const app = await appRes.json()
  const keyRes = await page.request.post(`/api/v1/applications/${app.id}/keys`, { data: { name: 'e2e' } })
  expect(keyRes.status(), await keyRes.text()).toBe(201)
  const { key } = await keyRes.json()
  const auth = { authorization: `Bearer ${key}` }

  const created = await request.post('/api/v1/tickets', { headers: auth, data: { ticket_type_id: general.id, title: 'Card declined', description: 'At checkout.', contact: { external_id: 'c1', name: 'Jordan Morales', email: 'jordan@shop.example' } } })
  expect(created.status(), await created.text()).toBe(201)
  const { ref } = await created.json()
  await request.post(`/api/v1/tickets/${ref}/comments`, { headers: auth, data: { body: 'Is there any update?' } })
  const cancel = await request.post(`/api/v1/tickets/${ref}/cancel`, { headers: auth, data: {} })
  expect(cancel.status(), await cancel.text()).toBe(200)

  await page.goto(`/tickets/${ref}`)
  await expect(page.getByText('Is there any update?')).toBeVisible()
  await expect(page.getByText(`Contact · ${name}`).first()).toBeVisible()
  await expect(page.getByText('Jordan Morales').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Latest change:.*cancelled this ticket/ })).toBeVisible()
})
