import { describe, expect, it } from 'vitest'
import { firstUnusedColor, keyFromLabel, suggestIcon, suggestPrefix, TYPE_COLORS } from '../../shared/ticket-type-rules'

describe('ticket type suggestions', () => {
  it('makes a snake_case key from a label', () => {
    expect(keyFromLabel('Needed until')).toBe('needed_until')
    expect(keyFromLabel('  How often does it happen? ')).toBe('how_often_does_it_happen')
    expect(keyFromLabel('3D model')).toBe('f_3d_model')
    expect(keyFromLabel('???')).toBe('')
    expect(keyFromLabel('a'.repeat(60))).toHaveLength(40)
  })

  it('suggests the first word when it has 5 letters or fewer, else its first 3 letters', () => {
    expect(suggestPrefix('Access request')).toBe('ACC')
    expect(suggestPrefix('Bug')).toBe('BUG')
    expect(suggestPrefix('Data request')).toBe('DATA')
    expect(suggestPrefix('Hardware request')).toBe('HAR')
    expect(suggestPrefix('IT help')).toBe('IT')
    expect(suggestPrefix('')).toBe('')
  })

  it('suggests an icon from the name', () => {
    expect(suggestIcon('Payment issue')).toBe('i-lucide-credit-card')
    expect(suggestIcon('Access request')).toBe('i-lucide-key-round')
    expect(suggestIcon('Something else')).toBe('i-lucide-circle-help')
  })

  it('picks the first color that no other type uses', () => {
    expect(firstUnusedColor([])).toBe(TYPE_COLORS[0].color)
    expect(firstUnusedColor(['#c2362f', '#0E7377'])).toBe('#6142C4')
    expect(firstUnusedColor(TYPE_COLORS.map(c => c.color))).toBe(TYPE_COLORS[0].color)
  })
})
