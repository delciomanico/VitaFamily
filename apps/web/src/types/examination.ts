import type { DocumentInfo } from './document'

/** Exame — categoria C6 (docs/04-domain/entities.md → Examination, ExamResult). */
export type ExaminationStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'

export interface Examination {
  id: string
  familyId: string
  memberId: string
  name: string
  /** Data ISO. */
  examDate: string
  status: ExaminationStatus
  clinicId?: string
  clinicName?: string
  notes?: string
}

export interface ExamResult {
  id: string
  examinationId: string
  parameter: string
  valueNumeric?: number
  valueText?: string
  unit?: string
  /** Referências informadas pelo utilizador; nunca interpretadas como diagnóstico. */
  referenceMin?: number
  referenceMax?: number
  createdAt: string
}

/** Linha da lista de exames. */
export interface ExaminationSummary {
  examination: Examination
  memberName: string
  resultCount: number
}

export interface ExaminationDetail {
  examination: Examination
  memberName: string
  results: ExamResult[]
  documents: DocumentInfo[]
}

/** Valor de um parâmetro num exame, para o histórico (UC-EXM-04). */
export interface ParameterPoint {
  examinationId: string
  examDate: string
  result: ExamResult
}

/** Histórico de um parâmetro do membro ao longo do tempo, do mais antigo ao mais recente. */
export interface ParameterHistory {
  parameter: string
  unit?: string
  points: ParameterPoint[]
}
