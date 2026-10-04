import { describe, expect, it } from 'vitest'
import { initials } from './Avatar'

describe('initials', () => {
  it.each([
    ['Maria', 'M'],
    ['Maria Monarca', 'MM'],
    ['  joão  pedro silva ', 'JS'],
    ['', ''],
  ])('%j → %j', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})
