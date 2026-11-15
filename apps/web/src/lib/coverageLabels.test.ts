import { describe, expect, it } from 'vitest'
import { alertCategoryOf, alertTitle, coverageText, nextStepSentence } from './labels'
import type { ProcessCoverage } from '@/types/process'

const day = (iso: string) => `dia ${iso.slice(0, 10)}`
const base: ProcessCoverage = { state: 'PENDING', appeal: false, partial: false, dueAt: null, validUntil: null }
const UNTIL = '2026-12-10T23:59:00Z'

describe('textos do pedido à seguradora (process-flows.md §14)', () => {
  it.each<[string, ProcessCoverage, string]>([
    ['PENDING com prazo', { ...base, dueAt: '2026-11-17T12:00:00Z' }, 'A seguradora está a analisar o pedido. Resposta prevista até dia 2026-11-17.'],
    ['PENDING sem prazo', base, 'A seguradora está a analisar o pedido.'],
    ['PENDING nova análise', { ...base, appeal: true }, 'A seguradora está a fazer uma nova análise do pedido.'],
    ['NEEDS_INFO', { ...base, state: 'NEEDS_INFO' }, 'A clínica está a completar o pedido à seguradora.'],
    ['APPROVED', { ...base, state: 'APPROVED', validUntil: UNTIL }, 'A seguradora aprovou o pedido. Válido até dia 2026-12-10.'],
    ['APPROVED em parte', { ...base, state: 'APPROVED', partial: true, validUntil: UNTIL }, 'A seguradora aprovou o pedido em parte. Válido até dia 2026-12-10.'],
    ['APPROVED nova análise', { ...base, state: 'APPROVED', appeal: true, validUntil: UNTIL }, 'Depois de uma nova análise, a seguradora aprovou o pedido. Válido até dia 2026-12-10.'],
    ['NOT_APPROVED', { ...base, state: 'NOT_APPROVED' }, 'A seguradora não aprovou o pedido. A clínica pode pedir uma nova análise. Para saber mais, fale com a seguradora.'],
    ['NOT_APPROVED nova análise', { ...base, state: 'NOT_APPROVED', appeal: true }, 'Depois de uma nova análise, a seguradora não aprovou o pedido. Para saber mais, fale com a seguradora.'],
    ['EXPIRED', { ...base, state: 'EXPIRED', validUntil: UNTIL }, 'A aprovação expirou em dia 2026-12-10. Se ainda precisar, fale com a clínica para fazer um novo pedido.'],
    ['WITHDRAWN', { ...base, state: 'WITHDRAWN' }, 'A seguradora cancelou a aprovação. Para saber mais, fale com a seguradora.'],
  ])('%s', (_name, coverage, text) => {
    expect(coverageText(coverage, day)?.headline).toBe(text)
  })

  it('aprovado diz o que fazer a seguir; estado desconhecido => sem bloco', () => {
    expect(coverageText({ ...base, state: 'APPROVED' }, day)?.hint).toBe('Marque ou compareça no atendimento.')
    expect(coverageText({ ...base, state: 'NOVO' as never }, day)).toBeUndefined()
  })

  it('nenhum texto usa vocabulário técnico (autorização, guia, recurso, analista) nem motivo/valor', () => {
    const states: ProcessCoverage['state'][] = ['PENDING', 'NEEDS_INFO', 'APPROVED', 'NOT_APPROVED', 'EXPIRED', 'WITHDRAWN']
    const texts = states.flatMap((state) =>
      [false, true].flatMap((appeal) => {
        const t = coverageText({ ...base, state, appeal, partial: true, dueAt: UNTIL, validUntil: UNTIL }, day)
        return [t?.headline, t?.hint]
      }),
    )
    const steps = ['AWAIT_INSURER_DECISION', 'AWAIT_CLINIC_INFORMATION', 'COVERAGE_NOT_APPROVED', 'COVERAGE_EXPIRED', 'COVERAGE_WITHDRAWN', 'ATTEND'].map((code) => nextStepSentence({ code, actor: 'FAMILY' }, day))
    const alerts = (['AUTHORIZATION_APPROVED', 'AUTHORIZATION_NOT_APPROVED', 'AUTHORIZATION_INFO_REQUESTED', 'AUTHORIZATION_EXPIRING', 'AUTHORIZATION_WITHDRAWN'] as const).map((type) => alertTitle({ type, ruleKey: 'authorization.approved', sourceLabel: '', message: undefined }))
    for (const text of [...texts, ...steps, ...alerts]) expect(text ?? '').not.toMatch(/autoriza|guia|recurso|analista|motivo|valor|€|decisor/i)
  })

  it('os passos novos (COVERAGE_EXPIRED/COVERAGE_WITHDRAWN) são da família e os 5 alertas têm texto e categoria', () => {
    expect(nextStepSentence({ code: 'COVERAGE_EXPIRED', actor: 'FAMILY' }, day)).toBe('Se ainda precisar, fale com a clínica.')
    expect(nextStepSentence({ code: 'COVERAGE_WITHDRAWN', actor: 'FAMILY' }, day)).toBe('Para saber mais, fale com a seguradora.')
    expect(alertTitle({ type: 'AUTHORIZATION_EXPIRING', ruleKey: 'authorization.expiring', sourceLabel: '', message: undefined })).toBe('Uma aprovação da seguradora expira em breve.')
    expect(alertCategoryOf.AUTHORIZATION_WITHDRAWN).toBe('FOLLOW_UP')
  })
})
