import { describe, expect, it } from 'vitest'
import { isCurrent, navigationFor } from '../../app/utils/navigation'

describe('navigationFor', () => {
  it('lists Settings for Admins only', () => {
    expect(navigationFor('admin').map(i => i.to)).toContain('/settings')
    expect(navigationFor('agent').map(i => i.to)).not.toContain('/settings')
    expect(navigationFor('requester').map(i => i.to)).not.toContain('/settings')
    expect(navigationFor(undefined)).toEqual([])
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
