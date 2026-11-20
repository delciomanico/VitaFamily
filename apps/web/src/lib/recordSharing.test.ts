import { describe, expect, it } from 'vitest'
import { ageBetween, professionalShareStatusText, safeHref } from './recordSharing'

describe('recordSharing', () => {
  it('safeHref só aceita http(s)', () => {
    expect(safeHref('https://meet.exemplo.ao/sala')).toBe('https://meet.exemplo.ao/sala')
    expect(safeHref('http://exemplo.ao')).toBe('http://exemplo.ao/')
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('data:text/html,<b>x</b>')).toBeUndefined()
    expect(safeHref('+244 923 000 000')).toBeUndefined()
    expect(safeHref(undefined)).toBeUndefined()
  })

  it('idade em anos completos', () => {
    expect(ageBetween('1985-03-12', '2026-03-11')).toBe(40)
    expect(ageBetween('1985-03-12', '2026-03-12')).toBe(41)
    expect(ageBetween('2026-11-20', '2026-11-20')).toBe(0)
  })

  it('o profissional não distingue prazo de revogação', () => {
    expect(professionalShareStatusText('EXPIRED', false).label).toBe(professionalShareStatusText('REVOKED', false).label)
    expect(professionalShareStatusText('CONSUMED', false).label).toBe('Já visto')
    expect(professionalShareStatusText('ACTIVE', true).label).toBe('Disponível')
  })
})
