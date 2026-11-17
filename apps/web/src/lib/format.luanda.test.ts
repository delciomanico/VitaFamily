import { describe, expect, it } from 'vitest'
import { formatTimeLuanda, formatWhenLuanda, luandaDayISO } from './format'

describe('formato em Africa/Luanda', () => {
  it('mostra a hora de Luanda (UTC+1), seja qual for o fuso do dispositivo', () => {
    expect(formatTimeLuanda('2026-11-20T08:00:00.000Z')).toBe('09:00')
  })
  it('o dia vem de Luanda (23:30 UTC já é o dia seguinte)', () => {
    expect(luandaDayISO('2026-11-20T23:30:00.000Z')).toBe('2026-11-21')
  })
  it('hoje e amanhã são relativos a Luanda', () => {
    const now = new Date('2026-11-20T10:00:00.000Z')
    expect(formatWhenLuanda('2026-11-20T08:00:00.000Z', now)).toBe('Hoje · 09:00')
    expect(formatWhenLuanda('2026-11-20T23:30:00.000Z', now)).toBe('Amanhã · 00:30')
  })
})
