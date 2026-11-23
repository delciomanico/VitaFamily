import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import { day } from '../time'
import * as summary from './healthSummary'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 14, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const PERIOD = { from: day(-60, NOW), to: day(0, NOW) }

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

function dose(planId: string, memberId: string, offsetHours: number, status: 'TAKEN' | 'NOT_TAKEN' | 'UNCONFIRMED' | 'PENDING') {
  db.doses.push({ id: `d_${db.doses.length}`, familyId: FAMILY, memberId, planId, scheduledAt: new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString(), status })
}

beforeEach(() => resetDb(NOW))

describe('período (BR-RPT-12, TC-RPT-05)', () => {
  it('omissão = 12 meses; from > to e mais de 5 anos → VALIDATION_ERROR', async () => {
    const s = await summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_monarca', {}, NOW)
    expect(s.period).toEqual({ from: '2025-10-14', to: '2026-10-14' })
    expect(await code(summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_monarca', { from: '2026-10-10', to: '2026-10-01' }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_monarca', { from: '2020-01-01', to: '2026-10-01' }, NOW))).toBe('VALIDATION_ERROR')
    expect(await code(summary.getFamilyHealthSummary(FAMILY, MONARCA, { from: '2020-01-01', to: '2026-10-01' }, NOW))).toBe('VALIDATION_ERROR')
  })

  it('membro de outra família → NOT_FOUND', async () => {
    expect(await code(summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_inexistente', {}, NOW))).toBe('NOT_FOUND')
  })
})

describe('adesão (BR-RPT-13, TC-RPT-06)', () => {
  it('6 tomadas, 2 não tomadas, 2 por confirmar e 4 futuras → 60 % e pending = 4', async () => {
    db.doses.length = 0
    const plan = db.medicationPlans.find((p) => p.memberId === 'mem_monarca')!
    for (let i = 1; i <= 6; i++) dose(plan.id, 'mem_monarca', -i * 24, 'TAKEN')
    for (let i = 7; i <= 8; i++) dose(plan.id, 'mem_monarca', -i * 24, 'NOT_TAKEN')
    for (let i = 9; i <= 10; i++) dose(plan.id, 'mem_monarca', -i * 24, 'UNCONFIRMED')
    for (let i = 1; i <= 4; i++) dose(plan.id, 'mem_monarca', i * 2, 'PENDING')
    const s = await summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_monarca', PERIOD, NOW)
    expect(s.medication?.overall).toMatchObject({ taken: 6, notTaken: 2, unconfirmed: 2, adherencePct: 60 })
    expect(s.medication?.byMedication[0]).toMatchObject({ planId: plan.id, pending: 4, adherencePct: 60 })
    expect(s.medication?.granularity).toBe('WEEK')
  })

  it('sem tomas → adherencePct null (nunca 0); período > 90 dias → série mensal', async () => {
    db.doses.length = 0
    const s = await summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_monarca', { from: day(-200, NOW), to: day(0, NOW) }, NOW)
    expect(s.medication?.overall.adherencePct).toBeNull()
    expect(s.medication?.byMedication).toEqual([])
    expect(s.medication?.granularity).toBe('MONTH')
  })
})

describe('séries de exames (BR-RPT-14, TC-RPT-07)', () => {
  it('min/max/primeiro/último/variação; texto fora; unidades separadas; sem marca de «fora da referência»', async () => {
    db.examResults.length = 0
    db.examinations.length = 0
    const exams = [-40, -20, -5].map((offset, i) => {
      const id = `ex_t${i}`
      db.examinations.push({ id, familyId: FAMILY, memberId: 'mem_monarca', name: 'Análises', examDate: day(offset, NOW), status: 'COMPLETED' })
      return id
    })
    const add = (examinationId: string, parameter: string, extra: Record<string, unknown>) =>
      db.examResults.push({ id: `r_${db.examResults.length}`, examinationId, parameter, createdAt: NOW.toISOString(), ...extra })
    ;[100, 130, 120].forEach((v, i) => add(exams[i]!, 'Glicemia', { valueNumeric: v, unit: 'mg/dL', referenceMin: 70, referenceMax: 99 }))
    add(exams[2]!, 'glicemia ', { valueNumeric: 5.4, unit: 'mmol/L' })
    add(exams[2]!, 'Cor da urina', { valueText: 'amarela' })
    const s = await summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_monarca', PERIOD, NOW)
    const series = s.exams!.series
    expect(series).toHaveLength(2)
    const mg = series.find((x) => x.unit === 'mg/dL')!
    expect(mg).toMatchObject({ count: 3, min: 100, max: 130, first: 100, last: 120, variationAbs: 20, variationPct: 20, referenceMin: 70, referenceMax: 99 })
    expect(series.find((x) => x.unit === 'mmol/L')).toMatchObject({ count: 1, variationAbs: null, variationPct: null })
    expect(JSON.stringify(s)).not.toMatch(/outOfRange|abnormal|foraDaReferencia/i)
  })
})

describe('tutela e permissões (BR-RPT-01/16, TC-RPT-08)', () => {
  it('o tutor vê o dependente; quem só tem partilhas vê só as categorias partilhadas (secções omitidas)', async () => {
    const joao = await summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_joao', PERIOD, NOW)
    expect(joao.medication).toBeDefined()
    expect(joao.exams).toBeDefined()

    const ana = await summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_ana', PERIOD, NOW)
    expect(ana.medication).toBeUndefined()
    expect(ana.exams).toBeUndefined()
    expect(ana.prescriptions).toBeUndefined()
    expect(ana.appointments).toBeDefined()
    // sem permissão de escrita, sem ligações aos registos
    expect(ana.missing?.every((m) => m.sourceIds === undefined)).toBe(true)

    const family = await summary.getFamilyHealthSummary(FAMILY, MONARCA, PERIOD, NOW)
    const anaBlock = family.members.find((m) => m.memberId === 'mem_ana')!
    expect(anaBlock.activity).not.toHaveProperty('dosesConfirmed')
    expect(anaBlock.activity).not.toHaveProperty('exams')
    expect(anaBlock).not.toHaveProperty('adherencePct')
  })
})

describe('contagens e o que falta (BR-RPT-15/17, TC-RPT-10/11)', () => {
  it('consultas e exames por estado, próximos 30 dias e itens de completude só com ligação a quem escreve', async () => {
    const s = await summary.getMemberHealthSummary(FAMILY, MONARCA, 'mem_joao', PERIOD, NOW)
    expect(s.appointments).toMatchObject({ upcoming30d: expect.any(Number) })
    const open = s.missing?.find((m) => m.code === 'APPOINTMENT_PAST_OPEN')
    expect(open?.count).toBeGreaterThan(0)
    expect(open?.sourceIds?.length).toBe(open?.count)
    // nunca sugere consultas ou exames
    expect(JSON.stringify(s.missing)).not.toMatch(/rotina|recomend|sugest/i)
  })
})
