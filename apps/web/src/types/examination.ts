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
