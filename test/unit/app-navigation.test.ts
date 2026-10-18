import { describe, expect, it } from 'vitest'
import { appNavigationPath } from '../../shared/app-navigation'

// Issue 39: `tikki:navigate` opens only a ticket or an app page.

describe('appNavigationPath', () => {
  it('accepts a ticket or an app page path, with a query and a hash', () => {
    expect(appNavigationPath('/tickets/PAY-1048')).toBe('/tickets/PAY-1048')
    expect(appNavigationPath('/tickets/PAY-1048?tab=activity#c-3')).toBe('/tickets/PAY-1048?tab=activity#c-3')
    expect(appNavigationPath('/apps/4')).toBe('/apps/4')
  })

  it.each([
    ['https://evil.test/'],
    ['//evil.test'],
    ['/sign-out'],
    ['/tickets'],
    ['/tickets?filter=mine'],
    ['/admin/apps'],
    ['tickets/PAY-1'],
    ['javascript:alert(1)'],
    ['/tickets//evil.test'],
    ['/tickets/\\evil.test'],
    ['/\\evil.test'],
    ['/tickets/\t/evil.test'],
    ['/tickets/a b'],
    ['/tickets/%2e%2e/sign-out'],
    ['/tickets/../sign-out'],
    ['/apps/%2E%2E/%2E%2E/settings'],
    ['/apps/' + 'x'.repeat(2000)],
  ])('ignores %j', (path) => {
    expect(appNavigationPath(path)).toBeNull()
  })

  it('ignores a value that is not a string', () => {
    for (const value of [undefined, null, 4, { path: '/tickets/PAY-1' }, ['/tickets/PAY-1']]) expect(appNavigationPath(value)).toBeNull()
  })
})
