import * as api from '@/mocks/handlers/examinations'

export type { ExamResultInput, NewExaminationInput } from '@/mocks/handlers/examinations'

/** Exames e resultados. Hoje mock; depois /api/v1/families/{id}/members/{id}/examinations. */
export const examinationService = {
  listExaminations: api.listExaminations,
  getExamination: api.getExamination,
  createExamination: api.createExamination,
  setExaminationStatus: api.setExaminationStatus,
  getParameterHistory: api.getParameterHistory,
}
