import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { formatReference, formatResultValue, isRecentExam, parseNumber } from '@/lib/examination'
import { db, resetDb } from '../db'
import * as exams from './examinations'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

const newExam = (examDate = '2026-10-01'): exams.NewExaminationInput => ({
  memberId: 'mem_monarca',
  name: 'Perfil lipídico',
  examDate,
  clinicName: 'laboratório vida plena',
  results: [{ parameter: 'Colesterol total', valueNumeric: 180, unit: 'mg/dL', referenceMax: 190 }],
  documents: [],
})

beforeEach(() => resetDb(NOW))

describe('apresentação', () => {
  it('mostra valor e referência sem interpretar', () => {
    const result = db.examResults.find((r) => r.id === 'res_gl_2026')!
    expect(formatResultValue(result)).toBe('112 mg/dL')
    expect(formatReference(result)).toBe('Referência: 70–99 mg/dL')
    expect(formatReference({ referenceMax: 5.7, unit: '%' })).toBe('Referência: até 5,7 %')
  })

  it('aceita vírgula decimal e recusa texto', () => {
    expect(parseNumber('13,2')).toBe(13.2)
    expect(parseNumber('Negativo')).toBeNull()
  })

  it('recentes: agendados e realizados nos últimos 90 dias', () => {
    const byId = (id: string) => db.examinations.find((e) => e.id === id)!
    expect(isRecentExam(byId('exm_2026'), NOW)).toBe(true)
    expect(isRecentExam(byId('exm_maria'), NOW)).toBe(true)
    expect(isRecentExam(byId('exm_2025'), NOW)).toBe(false)
  })
})

describe('exames', () => {
  it('lista os exames visíveis com o número de resultados', async () => {
    const list = await exams.listExaminations(FAMILY, MONARCA)
    expect(list.find((e) => e.examination.id === 'exm_2026')?.resultCount).toBe(2)
    expect(list.map((e) => e.examination.examDate)).toEqual(
      [...list.map((e) => e.examination.examDate)].sort().reverse(),
    )
  })

  it('detalhe traz resultados e documento', async () => {
    const detail = await exams.getExamination(FAMILY, MONARCA, 'exm_2026')
    expect(detail.results.map((r) => r.parameter)).toEqual(['Hemoglobina', 'Glicemia em jejum'])
    expect(detail.documents.map((d) => d.originalName)).toEqual(['boletim-analises.pdf'])
  })

  it('exame passado nasce realizado, com resultados e clínica reconhecida', async () => {
    const exam = await exams.createExamination(FAMILY, MONARCA, newExam(), NOW)
    expect(exam).toMatchObject({ status: 'COMPLETED', clinicId: 'cln_vidaplena', clinicName: 'Laboratório Vida Plena' })
    expect(db.examResults.filter((r) => r.examinationId === exam.id)).toHaveLength(1)
  })

  it('exame futuro fica agendado e não aceita resultados', async () => {
    expect(await code(exams.createExamination(FAMILY, MONARCA, newExam('2026-10-20'), NOW))).toBe('VALIDATION_ERROR')
    const exam = await exams.createExamination(FAMILY, MONARCA, { ...newExam('2026-10-20'), results: [] }, NOW)
    expect(exam.status).toBe('SCHEDULED')
  })

  it('recusa resultado sem valor ou com referência invertida', async () => {
    const bad = (result: exams.ExamResultInput) =>
      code(exams.createExamination(FAMILY, MONARCA, { ...newExam(), results: [result] }, NOW))
    expect(await bad({ parameter: 'X' })).toBe('VALIDATION_ERROR')
    expect(await bad({ parameter: 'X', valueNumeric: 1, referenceMin: 10, referenceMax: 5 })).toBe('VALIDATION_ERROR')
  })

  it('marca um agendado como realizado ou cancelado, só uma vez', async () => {
    const exam = await exams.setExaminationStatus(FAMILY, MONARCA, 'exm_maria', 'CANCELLED')
    expect(exam.status).toBe('CANCELLED')
    expect(await code(exams.setExaminationStatus(FAMILY, MONARCA, 'exm_maria', 'COMPLETED'))).toBe('VALIDATION_ERROR')
  })

  it('histórico da glicemia: 3 anos, do mais antigo ao mais recente', async () => {
    const history = await exams.getParameterHistory(FAMILY, MONARCA, 'exm_2026')
    const glucose = history.find((h) => h.parameter === 'Glicemia em jejum')!
    expect(glucose.points.map((p) => p.result.valueNumeric)).toEqual([92, 101, 112])
    expect(history.find((h) => h.parameter === 'Hemoglobina')?.points).toHaveLength(1)
  })

  it('sem acesso responde NOT_FOUND', async () => {
    expect(await code(exams.getExamination(FAMILY, 'usr_ninguem', 'exm_2026'))).toBe('NOT_FOUND')
    expect(await code(exams.getParameterHistory('fam_outra', MONARCA, 'exm_2026'))).toBe('NOT_FOUND')
  })
})
