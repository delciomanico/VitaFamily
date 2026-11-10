import * as mock from '@/mocks/handlers/clinicReports'
import { hasApiBackend } from '@/lib/apiClient'
import { clinicApiFetch, clinicApiFetchBlob } from '@/lib/clinicApiClient'
import { AppError, isAppError } from '@/lib/errors'
import { clinicSessionStore } from '@/lib/storage'
import type {
  ClinicExamResultsDraft,
  ClinicExamResultsDraftInput,
  ConsultationReport,
  ConsultationReportInput,
} from '@/types/clinicReport'

/**
 * Relatório da consulta e rascunho de resultados do portal da clínica (M15, ADR-027). Mesmo padrão
 * dos outros serviços: backend simulado sem `VITE_API_URL`; com ele, `clinicApiFetch`. Quem
 * escreve é o Médico (BR-CLN-44); o servidor decide, a UI só esconde o que não pode.
 */

/** Corpo de `ConsultationReportInput`: texto simples; secção vazia = nula (BR-CLN-41). */
export function reportBody(input: ConsultationReportInput) {
  const text = (value?: string) => value?.trim() || null
  return {
    reason: text(input.reason),
    findings: text(input.findings),
    impression: text(input.impression),
    plan: text(input.plan),
    ...(input.sharedWithPatient === undefined ? {} : { sharedWithPatient: input.sharedWithPatient }),
  }
}

interface ApiConsultationReport extends Omit<ConsultationReport, 'reason' | 'findings' | 'impression' | 'plan' | 'specialty' | 'finalizedAt'> {
  reason?: string | null
  findings?: string | null
  impression?: string | null
  plan?: string | null
  specialty?: string | null
  finalizedAt?: string | null
  authorAccountId?: string | null
  patientBirthDate?: string | null
}

const toReport = (r: ApiConsultationReport): ConsultationReport => ({
  id: r.id,
  bookingKind: r.bookingKind,
  bookingId: r.bookingId,
  status: r.status,
  reason: r.reason ?? undefined,
  findings: r.findings ?? undefined,
  impression: r.impression ?? undefined,
  plan: r.plan ?? undefined,
  sharedWithPatient: r.sharedWithPatient,
  patientName: r.patientName,
  consultationAt: r.consultationAt,
  specialty: r.specialty ?? undefined,
  authorName: r.authorName,
  finalizedAt: r.finalizedAt ?? undefined,
  addenda: r.addenda,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

interface ApiExamDraft {
  examinationId: string
  status: 'DRAFT'
  results: Array<{
    parameter: string
    valueNumeric?: number | null
    valueText?: string | null
    unit?: string | null
    referenceMin?: number | null
    referenceMax?: number | null
  }>
  resultNote?: string | null
  updatedAt: string
}

const toDraft = (d: ApiExamDraft): ClinicExamResultsDraft => ({
  examinationId: d.examinationId,
  status: 'DRAFT',
  results: d.results.map((r) => ({
    parameter: r.parameter,
    valueNumeric: r.valueNumeric ?? undefined,
    valueText: r.valueText ?? undefined,
    unit: r.unit ?? undefined,
    referenceMin: r.referenceMin ?? undefined,
    referenceMax: r.referenceMax ?? undefined,
  })),
  resultNote: d.resultNote ?? undefined,
  updatedAt: d.updatedAt,
})

/** `NOT_FOUND` quando ainda não existe (rascunho/relatório por criar) vira `null`. */
const orNull = <T>(promise: Promise<T>): Promise<T | null> =>
  promise.catch((error: unknown) => {
    if (isAppError(error, 'NOT_FOUND')) return null
    throw error
  })

const reportPath = (bookingId: string) => `/agenda/${bookingId}/report`

const apiImpl = {
  get: (bookingId: string) =>
    orNull(clinicApiFetch<ApiConsultationReport>(reportPath(bookingId)).then(toReport)),
  save: async (bookingId: string, input: ConsultationReportInput) =>
    toReport(await clinicApiFetch<ApiConsultationReport>(reportPath(bookingId), { method: 'PUT', body: reportBody(input) })),
  finalize: async (bookingId: string) =>
    toReport(await clinicApiFetch<ApiConsultationReport>(`${reportPath(bookingId)}/finalize`, { method: 'PUT' })),
  addAddendum: async (bookingId: string, text: string) =>
    toReport(
      await clinicApiFetch<ApiConsultationReport>(`${reportPath(bookingId)}/addenda`, {
        method: 'POST',
        body: { text: text.trim() },
      }),
    ),
  pdf: (bookingId: string) => clinicApiFetchBlob(`${reportPath(bookingId)}/pdf`),
}

function mockAccountId(): string {
  const clinicAccountId = clinicSessionStore.getAccountId()
  if (!clinicAccountId) throw new AppError('INVALID_CREDENTIALS')
  return clinicAccountId
}

const mockImpl: typeof apiImpl = {
  get: (bookingId) => orNull(mock.getClinicConsultationReport(mockAccountId(), bookingId)),
  save: (bookingId, input) => mock.saveClinicConsultationReport(mockAccountId(), bookingId, input),
  finalize: (bookingId) => mock.finalizeClinicConsultationReport(mockAccountId(), bookingId),
  addAddendum: (bookingId, text) => mock.addClinicConsultationReportAddendum(mockAccountId(), bookingId, text),
  pdf: (bookingId) => mock.getClinicConsultationReportPdf(mockAccountId(), bookingId),
}

export const clinicReportService = hasApiBackend() ? apiImpl : mockImpl

// --- Exames: rascunho de resultados e laudo (BR-CLN-47..49) ---

const examPath = (examinationId: string) => `/exam-agenda/${examinationId}`

const examApiImpl = {
  getDraft: (examinationId: string) =>
    orNull(clinicApiFetch<ApiExamDraft>(`${examPath(examinationId)}/results-draft`).then(toDraft)),
  saveDraft: async (examinationId: string, input: ClinicExamResultsDraftInput) =>
    toDraft(
      await clinicApiFetch<ApiExamDraft>(`${examPath(examinationId)}/results-draft`, {
        method: 'PUT',
        body: {
          results: input.results.map((r) => ({
            parameter: r.parameter.trim(),
            valueNumeric: r.valueNumeric ?? null,
            valueText: r.valueText?.trim() || null,
            unit: r.unit?.trim() || null,
            referenceMin: r.referenceMin ?? null,
            referenceMax: r.referenceMax ?? null,
          })),
          resultNote: input.resultNote?.trim() || null,
        },
      }),
    ),
  discardDraft: (examinationId: string) =>
    clinicApiFetch<void>(`${examPath(examinationId)}/results-draft`, { method: 'DELETE' }),
  reportPdf: (examinationId: string) => clinicApiFetchBlob(`${examPath(examinationId)}/report/pdf`),
}

const examMockImpl: typeof examApiImpl = {
  getDraft: (id) => orNull(mock.getClinicExamResultsDraft(mockAccountId(), id)),
  saveDraft: (id, input) => mock.saveClinicExamResultsDraft(mockAccountId(), id, input),
  discardDraft: (id) => mock.discardClinicExamResultsDraft(mockAccountId(), id),
  reportPdf: (id) => mock.getClinicExamReportPdf(mockAccountId(), id),
}

export const examResultsDraftService = hasApiBackend() ? examApiImpl : examMockImpl
