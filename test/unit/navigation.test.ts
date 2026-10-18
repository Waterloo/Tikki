import { describe, expect, it } from 'vitest'
import { isCurrent, navigationFor } from '../../app/utils/navigation'

describe('navigationFor', () => {
  it('lists Settings for Admins only', () => {
    expect(navigationFor('admin').map(i => i.to)).toContain('/settings')
    expect(navigationFor('agent').map(i => i.to)).not.toContain('/settings')
    expect(navigationFor('requester').map(i => i.to)).not.toContain('/settings')
    expect(navigationFor(undefined)).toEqual([])
  })

  it('lists Types and fields for Admins only', () => {
    expect(navigationFor('admin').map(i => i.to)).toContain('/admin/types')
    expect(navigationFor('agent').map(i => i.to)).not.toContain('/admin/types')
    expect(navigationFor('requester').map(i => i.to)).not.toContain('/admin/types')
  })

  it('lists Ticket Apps for Admins only', () => {
    expect(navigationFor('admin').map(i => i.to)).toContain('/admin/apps')
    expect(navigationFor('agent').map(i => i.to)).not.toContain('/admin/apps')
    expect(navigationFor('requester').map(i => i.to)).not.toContain('/admin/apps')
  })

  it('lists Teams and users for Admins only', () => {
    expect(navigationFor('admin').map(i => i.to)).toContain('/people')
    expect(navigationFor('agent').map(i => i.to)).not.toContain('/people')
    expect(navigationFor('requester').map(i => i.to)).not.toContain('/people')
  })

  it('lists the Inbox for every role', () => {
    for (const role of ['admin', 'agent', 'requester'] as const) expect(navigationFor(role).map(i => i.to)).toContain('/inbox')
  })

  it('lists Applications for Admins only, and marks it current on an Application page', () => {
    const item = navigationFor('admin').find(i => i.to === '/applications')!
    expect(item.label).toBe('Applications')
    expect(navigationFor('agent').map(i => i.to)).not.toContain('/applications')
    expect(isCurrent(item, '/applications/3', '/applications/3')).toBe(true)
    expect(isCurrent(item, '/applications-old', '/applications-old')).toBe(false)
    const all = navigationFor('admin').find(i => i.to === '/tickets')!
    expect(isCurrent(all, '/tickets?filter=mine', '/tickets')).toBe(false)
  })
})
