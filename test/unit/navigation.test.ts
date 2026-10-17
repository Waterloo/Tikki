import { describe, expect, it } from 'vitest'
import { navigationFor } from '../../app/utils/navigation'

describe('navigationFor', () => {
  it('lists Settings for Admins only', () => {
    expect(navigationFor('admin').map(i => i.to)).toContain('/settings')
    expect(navigationFor('agent').map(i => i.to)).not.toContain('/settings')
    expect(navigationFor('requester').map(i => i.to)).not.toContain('/settings')
    expect(navigationFor(undefined)).toEqual([])
  })

  it('lists the Inbox for every role', () => {
    for (const role of ['admin', 'agent', 'requester'] as const) expect(navigationFor(role).map(i => i.to)).toContain('/inbox')
  })
})
