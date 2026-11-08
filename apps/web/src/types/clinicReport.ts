/** Relatório da consulta e rascunho de resultados (M15, ADR-027; `openapi.yaml`). */

export type ReportSection = 'reason' | 'findings' | 'impression' | 'plan'

/** Limites do contrato por secção (BR-CLN-41). */
export const REPORT_LIMITS: Record<ReportSection, number> = {
  reason: 300,
  findings: 1500,
  impression: 500,
  plan: 1500,
}
export const REPORT_SECTIONS: ReportSection[] = ['reason', 'findings', 'impression', 'plan']
/** Limite do texto da adenda e máximo de adendas (BR-CLN-43). */
export const ADDENDUM_MAX_LENGTH = 1500
export const ADDENDA_MAX = 20

/** `ConsultationReportInput`. */
export interface ConsultationReportInput {
  reason?: string
  findings?: string
  impression?: string
  plan?: string
  /** Omissão true; visita manual = sempre false; imutável depois de FINAL (BR-CLN-45). */
  sharedWithPatient?: boolean
}

export interface ConsultationReportAddendum {
  id: string
  text: string
  authorName: string
  createdAt: string
}

/** `ConsultationReport`: visão da clínica. */
export interface ConsultationReport {
  id: string
  bookingKind: 'APPOINTMENT' | 'VISIT'
  bookingId: string
  status: 'DRAFT' | 'FINAL'
  reason?: string
  findings?: string
  impression?: string
  plan?: string
  sharedWithPatient: boolean
  patientName: string
  consultationAt: string
  specialty?: string
  authorName: string
  finalizedAt?: string
  addenda: ConsultationReportAddendum[]
  createdAt: string
  updatedAt: string
}

/** `FamilyConsultationReport`: visão do titular/tutor (só FINAL partilhado). */
export interface FamilyConsultationReport {
  appointmentId: string
  clinicName: string
  consultationAt: string
  specialty?: string
  authorName: string
  reason?: string
  findings?: string
  impression?: string
  plan?: string
  finalizedAt: string
  addenda: ConsultationReportAddendum[]
  notice: string
}

/** Parâmetro do rascunho de resultados (mesmo esquema de `ExamResultInput`). */
export interface ExamDraftResult {
  parameter: string
  valueNumeric?: number
  valueText?: string
  unit?: string
  referenceMin?: number
  referenceMax?: number
}

/** `ClinicExamResultsDraft` (BR-CLN-47). */
export interface ClinicExamResultsDraft {
  examinationId: string
  status: 'DRAFT'
  results: ExamDraftResult[]
  resultNote?: string
  updatedAt: string
}
export type ClinicExamResultsDraftInput = Pick<ClinicExamResultsDraft, 'results' | 'resultNote'>
