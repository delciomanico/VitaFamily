import { todayISO } from '@/lib/date'
import { AppError } from '@/lib/errors'
import { parameterKey } from '@/lib/examination'
import type { DocumentUpload } from '@/types/document'
import type {
  ExamResult,
  Examination,
  ExaminationDetail,
  ExaminationSummary,
  ParameterHistory,
} from '@/types/examination'
import { findVisibleMember, memberName, visibleMemberIds } from '../access'
import { db, newId } from '../db'
import { attachDocuments, documentsOf, validateUploads } from '../documents'
import { respond } from '../respond'

/** Resultado estruturado (BR-EXM-01): valor numérico ou texto livre, referência opcional do utilizador. */
export interface ExamResultInput {
  parameter: string
  valueNumeric?: number
  valueText?: string
  unit?: string
  referenceMin?: number
  referenceMax?: number
}

export interface NewExaminationInput {
  memberId: string
  name: string
  examDate: string
  clinicName?: string
  notes?: string
  results: ExamResultInput[]
  documents: DocumentUpload[]
}

/*
 * Exames (C6). TODO(N2): dependentes com conta não veem exames; na demo nenhum dependente tem conta.
 * TODO(fase 10): exame futuro gera lembrete 24 h antes (BR-EXM-03).
 */

function inScope(familyId: string, userId: string) {
  const visible = new Set(visibleMemberIds(familyId, userId))
  return (item: { familyId: string; memberId: string }) => item.familyId === familyId && visible.has(item.memberId)
}

function findExamination(familyId: string, userId: string, id: string): Examination {
  const exam = db.examinations.find((e) => e.id === id)
  if (!exam || !inScope(familyId, userId)(exam)) throw new AppError('NOT_FOUND')
  return exam
}

const resultsOf = (examinationId: string) => db.examResults.filter((r) => r.examinationId === examinationId)

function validateResult(result: ExamResultInput) {
  const hasValue = result.valueNumeric !== undefined || Boolean(result.valueText?.trim())
  const { referenceMin: min, referenceMax: max } = result
  if (!result.parameter.trim() || !hasValue) throw new AppError('VALIDATION_ERROR')
  if (min !== undefined && max !== undefined && min > max) throw new AppError('VALIDATION_ERROR')
}

/** Clínica parceira ou da própria família com o mesmo nome; senão fica só o texto (BR-CLN-02). */
function matchClinic(familyId: string, name?: string) {
  const wanted = name?.trim()
  if (!wanted) return {}
  const clinic = db.clinics.find(
    (c) =>
      c.status === 'ACTIVE' &&
      (c.type === 'PARTNER' || c.familyId === familyId) &&
      c.name.toLocaleLowerCase('pt-PT') === wanted.toLocaleLowerCase('pt-PT'),
  )
  return { clinicId: clinic?.id, clinicName: clinic?.name ?? wanted }
}

/** Nomes de clínicas e laboratórios que a família pode escolher (sugestões no formulário). */
export function listClinicNames(familyId: string) {
  return respond(() =>
    db.clinics
      .filter((c) => c.status === 'ACTIVE' && (c.type === 'PARTNER' || c.familyId === familyId))
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b, 'pt-PT')),
  )
}

/** Exames visíveis, mais recentes primeiro (UC-EXM-04). */
export function listExaminations(familyId: string, userId: string) {
  return respond((): ExaminationSummary[] =>
    db.examinations
      .filter(inScope(familyId, userId))
      .sort((a, b) => b.examDate.localeCompare(a.examDate))
      .map((examination) => ({
        examination,
        memberName: memberName(examination.memberId),
        resultCount: resultsOf(examination.id).length,
      })),
  )
}

export function getExamination(familyId: string, userId: string, id: string) {
  return respond((): ExaminationDetail => {
    const examination = findExamination(familyId, userId, id)
    return {
      examination,
      memberName: memberName(examination.memberId),
      results: resultsOf(id),
      documents: documentsOf('EXAMINATION', id),
    }
  })
}

/**
 * Regista o exame (UC-EXM-01/02). Data passada → REALIZADO; futura → AGENDADO.
 * Resultados só em exames realizados (ST5).
 */
export function createExamination(
  familyId: string,
  userId: string,
  input: NewExaminationInput,
  now: Date = new Date(),
) {
  return respond((): Examination => {
    findVisibleMember(familyId, userId, input.memberId)
    const status = input.examDate > todayISO(now) ? 'SCHEDULED' : 'COMPLETED'
    if (!input.name.trim() || !input.examDate) throw new AppError('VALIDATION_ERROR')
    if (status === 'SCHEDULED' && input.results.length > 0) throw new AppError('VALIDATION_ERROR')
    input.results.forEach(validateResult)
    validateUploads(input.documents)

    const examination: Examination = {
      id: newId('exm'),
      familyId,
      memberId: input.memberId,
      name: input.name.trim(),
      examDate: input.examDate,
      status,
      ...matchClinic(familyId, input.clinicName),
      notes: input.notes?.trim() || undefined,
    }
    db.examinations.push(examination)

    for (const result of input.results) {
      db.examResults.push({
        id: newId('res'),
        examinationId: examination.id,
        parameter: result.parameter.trim(),
        valueNumeric: result.valueNumeric,
        valueText: result.valueText?.trim() || undefined,
        unit: result.unit?.trim() || undefined,
        referenceMin: result.referenceMin,
        referenceMax: result.referenceMax,
        createdAt: now.toISOString(),
      })
    }
    attachDocuments(
      input.documents,
      { familyId, memberId: input.memberId, resourceType: 'EXAMINATION', resourceId: examination.id },
      now,
    )
    return examination
  })
}

/** Marcar um exame agendado como realizado ou cancelá-lo (UC-EXM-06). */
export function setExaminationStatus(familyId: string, userId: string, id: string, status: 'COMPLETED' | 'CANCELLED') {
  return respond((): Examination => {
    const exam = findExamination(familyId, userId, id)
    if (exam.status !== 'SCHEDULED') throw new AppError('VALIDATION_ERROR')
    exam.status = status
    return exam
  })
}

/**
 * Histórico de cada parâmetro do exame nos exames realizados do mesmo membro,
 * do mais antigo ao mais recente. Só lista valores; não interpreta (BR-EXM-02).
 */
export function getParameterHistory(familyId: string, userId: string, id: string) {
  return respond((): ParameterHistory[] => {
    const exam = findExamination(familyId, userId, id)
    const memberExams = db.examinations
      .filter((e) => e.familyId === familyId && e.memberId === exam.memberId && e.status === 'COMPLETED')
      .sort((a, b) => a.examDate.localeCompare(b.examDate))

    return resultsOf(id).map((current: ExamResult): ParameterHistory => {
      const key = parameterKey(current.parameter)
      const points = memberExams.flatMap((e) =>
        resultsOf(e.id)
          .filter((r) => parameterKey(r.parameter) === key)
          .map((result) => ({ examinationId: e.id, examDate: e.examDate, result })),
      )
      return { parameter: current.parameter, unit: current.unit, points }
    })
  })
}
