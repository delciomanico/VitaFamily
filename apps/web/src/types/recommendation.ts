/** Recomendação clínica (BR-CLN-09, ADR-023): nota escrita pela clínica ligada a uma consulta ou exame dela. */
export interface Recommendation {
  id: string
  memberId: string
  appointmentId?: string
  examinationId?: string
  clinicName: string
  text: string
  /** ISO UTC. */
  createdAt: string
}

/** Recomendação vista pela clínica: só o nome do paciente (BR-CLN-03). */
export interface ClinicRecommendation {
  id: string
  appointmentId?: string
  examinationId?: string
  patientName: string
  text: string
  createdAt: string
}

/** Exatamente uma origem: consulta ou exame (BR-CLN-09). */
export type RecommendationOrigin = { appointmentId: string } | { examinationId: string }

export const RECOMMENDATION_MAX_LENGTH = 2000
