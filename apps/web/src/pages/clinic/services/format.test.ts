import { describe, expect, it } from 'vitest'
import { formatWeekdays, generationLines, parsePriceInput, priceToInput } from './format'

describe('formatos dos serviços', () => {
  it('converte o preço digitado em cêntimos', () => {
    expect(parsePriceInput('')).toBeUndefined()
    expect(parsePriceInput('15000')).toBe(1_500_000)
    expect(parsePriceInput('15 000,50')).toBe(1_500_050)
    expect(parsePriceInput('-1')).toBeNull()
    expect(parsePriceInput('abc')).toBeNull()
    expect(priceToInput(1_500_050)).toBe('15000,5')
    expect(priceToInput(undefined)).toBe('')
  })

  it('escreve os dias da semana em texto simples', () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe('Seg a Sex')
    expect(formatWeekdays([3, 1])).toBe('Seg, Qua')
    expect(formatWeekdays([1, 2, 3, 4, 5, 6, 7])).toBe('Todos os dias')
  })

  it('resume a geração', () => {
    const lines = generationLines({ created: 12, unchanged: 0, removed: 1, skippedOverlap: 0, skippedTimeOff: 2, keptBooked: 1 })
    expect(lines[0]).toBe('12 horários novos criados.')
    expect(lines.join(' ')).toContain('férias ou bloqueio')
    expect(generationLines({ created: 0, unchanged: 3, removed: 0, skippedOverlap: 0, skippedTimeOff: 0, keptBooked: 0 })[0]).toMatch(/Não foi preciso/)
  })
})
