import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { alertGroups, formatVariation, missingRow, statusCount } from '@/lib/summaryText'
import { rangeProblem, shortcutRange } from '@/lib/summaryPeriod'
import { AdherenceBars } from './AdherenceBars'
import { LineChart } from './LineChart'

describe('gráficos em SVG próprio', () => {
  it('LineChart desenha a linha e descreve-se por texto; sem pontos não desenha nada', () => {
    const { container, rerender } = render(<LineChart label="Evolução de Glicemia" points={[{ date: '2026-01-10', value: 100 }, { date: '2026-02-10', value: 130 }, { date: '2026-03-10', value: 120 }]} />)
    expect(screen.getByRole('img', { name: 'Evolução de Glicemia' })).toBeInTheDocument()
    expect(container.querySelector('polyline')).not.toBeNull()
    // sem faixas nem cores de referência (BR-EXM-02)
    expect(container.innerHTML).not.toMatch(/danger|warning|success/)
    rerender(<LineChart label="x" points={[]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('AdherenceBars: períodos sem tomas ficam vazios (nunca 0 %) e um só período não mostra tendência', () => {
    const bucket = (periodStart: string, adherencePct: number | null) => ({ periodStart, taken: 1, notTaken: 0, unconfirmed: 0, adherencePct })
    const { container, rerender } = render(<AdherenceBars granularity="WEEK" series={[bucket('2026-10-05', 80), bucket('2026-10-12', null)]} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/80 %.*sem tomas/)
    expect(container.querySelectorAll('[style]')).toHaveLength(1)
    rerender(<AdherenceBars granularity="WEEK" series={[bucket('2026-10-05', 80)]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('texto e período', () => {
  it('variação só com sinal aritmético; contagens e alertas em linguagem simples', () => {
    expect(formatVariation(20, ' %')).toBe('+20 %')
    expect(formatVariation(-8.5, ' %')).toBe('−8,5 %')
    expect(formatVariation(null)).toBeNull()
    expect(statusCount('COMPLETED', 3)).toBe('3 realizadas')
    expect(statusCount('XYZ', 1)).toBe('1 outra')
    expect(alertGroups({ MEDICATION_DUE: 2, EXAM_REMINDER: 1, APPOINTMENT_REMINDER: 3 })).toEqual([
      { label: 'Consultas', count: 3 },
      { label: 'Medicamentos', count: 2 },
      { label: 'Exames', count: 1 },
    ])
  })

  it('«o que falta»: só completude; ligação só com sourceIds (quem escreve)', () => {
    expect(missingRow({ code: 'EXAM_WITHOUT_RESULTS', count: 2, sourceIds: ['a', 'b'] })).toMatchObject({ text: '2 exames realizados sem resultados', to: '/app/health/examinations' })
    expect(missingRow({ code: 'EXAM_WITHOUT_RESULTS', count: 1, sourceIds: ['a'] }).to).toBe('/app/health/examinations/a')
    expect(missingRow({ code: 'EXAM_WITHOUT_RESULTS', count: 1 }).to).toBeUndefined()
    expect(missingRow({ code: 'BLOOD_TYPE_UNSET', count: 1 }).text).toBe('Tipo sanguíneo por indicar')
  })

  it('atalhos de 30/90 dias e 12 meses; datas à escolha até 5 anos', () => {
    expect(shortcutRange('30', '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-10-30' })
    expect(shortcutRange('90', '2026-10-30').from).toBe('2026-08-02')
    expect(shortcutRange('12m', '2026-10-30')).toEqual({ from: '2025-10-30', to: '2026-10-30' })
    expect(rangeProblem({ from: '2021-10-30', to: '2026-10-30' })).toBeNull()
    expect(rangeProblem({ from: '2021-10-29', to: '2026-10-30' })).toMatch(/5 anos/)
    expect(rangeProblem({ from: '2026-10-30', to: '2026-10-01' })).toMatch(/anterior/)
  })
})
