import type { DocumentInfo } from '@/types/document'
import type { ExamResult, Examination } from '@/types/examination'
import { at, day } from '../time'

const DAYS_PER_YEAR = 365

/** Exames fictícios. A glicemia de Monarca tem 3 anos de histórico para a tendência. */
export function seedExaminations(now: Date = new Date()): Examination[] {
  const lab = { familyId: 'fam_monarca', clinicId: 'cln_vidaplena', clinicName: 'Laboratório Vida Plena' }
  return [
    {
      ...lab,
      id: 'exm_2026',
      memberId: 'mem_monarca',
      name: 'Análises clínicas',
      examDate: day(-5, now),
      status: 'COMPLETED',
    },
    {
      ...lab,
      id: 'exm_2025',
      memberId: 'mem_monarca',
      name: 'Análises clínicas',
      examDate: day(-DAYS_PER_YEAR, now),
      status: 'COMPLETED',
    },
    {
      ...lab,
      id: 'exm_2024',
      memberId: 'mem_monarca',
      name: 'Análises clínicas',
      examDate: day(-2 * DAYS_PER_YEAR, now),
      status: 'COMPLETED',
    },
    {
      ...lab,
      id: 'exm_maria',
      memberId: 'mem_maria',
      name: 'Ecografia abdominal',
      examDate: day(10, now),
      status: 'SCHEDULED',
    },
    {
      // Amanhã: o lembrete de 24 h já disparou (alerta de exame na demo).
      ...lab,
      id: 'exm_pedro',
      memberId: 'mem_pedro',
      name: 'Análises clínicas',
      examDate: day(1, now),
      status: 'SCHEDULED',
    },
    {
      ...lab,
      id: 'exm_joao',
      memberId: 'mem_joao',
      name: 'Hemoglobina glicada',
      examDate: day(-20, now),
      status: 'COMPLETED',
    },
  ]
}

export function seedExamResults(now: Date = new Date()): ExamResult[] {
  const glucose = { parameter: 'Glicemia em jejum', unit: 'mg/dL', referenceMin: 70, referenceMax: 99 }
  return [
    {
      id: 'res_hb_2026',
      examinationId: 'exm_2026',
      parameter: 'Hemoglobina',
      valueNumeric: 13.2,
      unit: 'g/dL',
      referenceMin: 13,
      referenceMax: 17,
      createdAt: at(-1, '18:00', now),
    },
    { ...glucose, id: 'res_gl_2026', examinationId: 'exm_2026', valueNumeric: 112, createdAt: at(-1, '18:00', now) },
    {
      ...glucose,
      id: 'res_gl_2025',
      examinationId: 'exm_2025',
      valueNumeric: 101,
      createdAt: at(-DAYS_PER_YEAR, '18:00', now),
    },
    {
      ...glucose,
      id: 'res_gl_2024',
      examinationId: 'exm_2024',
      valueNumeric: 92,
      createdAt: at(-2 * DAYS_PER_YEAR, '18:00', now),
    },
    {
      id: 'res_hba1c',
      examinationId: 'exm_joao',
      parameter: 'Hemoglobina glicada (HbA1c)',
      valueNumeric: 6.8,
      unit: '%',
      referenceMax: 5.7,
      createdAt: at(-19, '12:00', now),
    },
  ]
}

/** Boletim das análises mais recentes de Monarca (só metadados). */
export function seedExamDocuments(now: Date = new Date()): DocumentInfo[] {
  return [
    {
      id: 'doc_exm_2026',
      familyId: 'fam_monarca',
      memberId: 'mem_monarca',
      resourceType: 'EXAMINATION',
      resourceId: 'exm_2026',
      originalName: 'boletim-analises.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 246_000,
      createdAt: at(-1, '18:05', now),
    },
  ]
}
