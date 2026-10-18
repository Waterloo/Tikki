import { describe, expect, it } from 'vitest'
import { isCurrent, isSettingsCurrent, isSettingsPath, navigationFor, SETTINGS_HOME, settingsFor } from '../../app/utils/navigation'

const SET_UP = ['/settings', '/people', '/admin/types', '/applications', '/webhooks', '/admin/apps']

describe('navigationFor', () => {
  it('lists only daily work, with the staff items for staff', () => {
    expect(navigationFor('admin').map(i => i.label)).toEqual(['Inbox', 'My tickets', 'Assigned to me', 'All tickets'])
    expect(navigationFor('agent').map(i => i.label)).toEqual(['Inbox', 'My tickets', 'Assigned to me', 'All tickets'])
    expect(navigationFor('requester').map(i => i.label)).toEqual(['Inbox', 'My tickets'])
    expect(navigationFor(undefined)).toEqual([])
  })

  it('has no set-up screen and no New ticket item (it is a button)', () => {
    for (const role of ['admin', 'agent', 'requester'] as const) {
      const paths = navigationFor(role).map(i => i.to)
      for (const path of [...SET_UP, '/tickets/new']) expect(paths).not.toContain(path)
    }
  })

  it('tells All tickets and Assigned to me apart by the query', () => {
    const all = navigationFor('admin').find(i => i.to === '/tickets')!
    const mine = navigationFor('admin').find(i => i.to === '/tickets?filter=mine')!
    expect(isCurrent(all, '/tickets?filter=mine')).toBe(false)
    expect(isCurrent(mine, '/tickets?filter=mine')).toBe(true)
    expect(isCurrent(all, '/tickets')).toBe(true)
  })
})

describe('settingsFor', () => {
  it('has the 4 groups in order, for Admins only', () => {
    expect(settingsFor('admin').map(g => g.label)).toEqual(['General', 'People', 'Tickets', 'Integrations'])
    expect(settingsFor('admin').flatMap(g => g.items.map(i => i.label))).toEqual([
      'Organization', 'Teams and users', 'Types and fields', 'Applications', 'Webhooks', 'Ticket Apps', 'Developer docs',
    ])
    expect(settingsFor('agent')).toEqual([])
    expect(settingsFor('requester')).toEqual([])
    expect(settingsFor(undefined)).toEqual([])
  })

  it('links every set-up screen, and the docs site as an external page', () => {
    const items = settingsFor('admin').flatMap(g => g.items)
    expect(items.filter(i => !i.external).map(i => i.to)).toEqual(SET_UP)
    expect(items.find(i => i.external)).toMatchObject({ label: 'Developer docs', to: '/docs/' })
  })

  it('marks an item current on its sub-pages, but not on a look-alike path', () => {
    const items = settingsFor('admin').flatMap(g => g.items)
    const find = (label: string) => items.find(i => i.label === label)!
    expect(isSettingsCurrent(find('Applications'), '/applications/3')).toBe(true)
    expect(isSettingsCurrent(find('Applications'), '/applications-old')).toBe(false)
    expect(isSettingsCurrent(find('Types and fields'), '/admin/types/new')).toBe(true)
    expect(isSettingsCurrent(find('Types and fields'), '/admin/apps')).toBe(false)
    expect(isSettingsCurrent(find('Developer docs'), '/docs/')).toBe(false)
  })
})

describe('isSettingsPath', () => {
  it('is true on the menu list and on each Settings page and its sub-pages', () => {
    for (const path of [SETTINGS_HOME, ...SET_UP, '/applications/3', '/admin/types/7', '/admin/types/new']) {
      expect(isSettingsPath(path), path).toBe(true)
    }
  })

  it('is false on daily-work pages', () => {
    for (const path of ['/', '/inbox', '/tickets', '/tickets/new', '/tickets/BUG-1', '/apps/2', '/settings-old', '/docs/']) {
      expect(isSettingsPath(path), path).toBe(false)
    }
  })
})
