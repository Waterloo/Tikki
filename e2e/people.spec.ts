import { expect, test, type Browser } from '@playwright/test'
import { signIn } from './sign-in'

// A fresh context: the shared session belongs to a Requester.
async function adminPage(browser: Browser) {
  const context = await browser.newContext({ storageState: undefined })
  const page = await context.newPage()
  await signIn(page, 'admin@example.com')
  return { context, page }
}

test('an Admin invites, creates a Team and deactivates a User', async ({ browser }) => {
  const { context, page } = await adminPage(browser)
  await page.getByRole('link', { name: 'Teams and users' }).first().click()
  await expect(page.getByRole('heading', { name: 'Teams and users' }).first()).toBeVisible()
  await expect(page.getByText('Who can sign in')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible()

  // Invite an address outside the allowed domain.
  const contractor = `contractor-${Date.now()}@northwind.test`
  await page.getByRole('button', { name: 'Invite people' }).click()
  await page.getByLabel('Email addresses').fill(contractor)
  await page.getByRole('button', { name: 'Send invite' }).click()
  const invited = page.getByRole('listitem').filter({ hasText: contractor })
  await expect(invited.getByText('Invited')).toBeVisible()

  // A domain address needs no invite, and the dialog says so.
  await page.getByRole('button', { name: 'Invite people' }).click()
  await page.getByLabel('Email addresses').fill('someone@example.com')
  await page.getByRole('button', { name: 'Send invite' }).click()
  await expect(page.getByText('needs no invite')).toBeVisible()
  await page.keyboard.press('Escape')

  // A new Team.
  const teamName = `Finance ${Date.now()}`
  await page.getByRole('button', { name: 'New team' }).click()
  await page.getByLabel('Name').fill(teamName)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: teamName })).toBeVisible()

  // Another User signs in; the Admin makes them an Agent, puts them in the Team, then deactivates them.
  const other = await browser.newContext({ storageState: undefined })
  const otherPage = await other.newPage()
  const email = `e2e-people-${Date.now()}@example.com`
  await signIn(otherPage, email)

  await page.reload()
  const row = page.getByRole('listitem').filter({ hasText: email })
  await row.getByRole('combobox', { name: `Role of ${email}` }).click()
  await page.getByRole('option', { name: 'Agent' }).click()
  await expect(page.getByText(`${email} is now an agent`)).toBeVisible()

  await page.getByRole('article').filter({ hasText: teamName }).getByRole('button', { name: `Edit ${teamName}` }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: 'Add an agent' }).click()
  await page.getByRole('option', { name: new RegExp(email) }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: `Remove ${email} from ${teamName}` })).toBeVisible()
  await page.keyboard.press('Escape')

  await row.getByRole('button', { name: 'Deactivate' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click()
  await expect(row.getByText('Deactivated', { exact: true })).toBeVisible()

  // The other User is signed out at once.
  await otherPage.reload()
  await expect(otherPage).toHaveURL(/sign-in/)

  await context.close()
  await other.close()
})

test('a Requester does not see Teams and users', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My tickets' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Teams and users' })).toHaveCount(0)
  await page.goto('/people')
  await expect(page.getByRole('heading', { name: 'My tickets' }).first()).toBeVisible()
})

test('at 375 px the page has no horizontal scroll', async ({ browser }) => {
  const { context, page } = await adminPage(browser)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/people')
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await context.close()
})
