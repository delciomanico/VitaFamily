/** Pedido de exame e declaração de presença (M15 U/V, ADR-028; `openapi.yaml`). */

export type ExamOrderStatus = 'ORDERED' | 'SCHEDULED' | 'FULFILLED' | 'CANCELLED'

/** Limites do contrato (BR-CLN-51). */
export const EXAM_ORDER_NAME_MAX = 80
export const EXAM_ORDER_NOTE_MAX = 200
export const EXAM_ORDER_MAX_ACTIVE = 5

/** `ExamOrderItemInput`: exatamente um de `name` e `serviceTypeId`. */
export interface ExamOrderItemInput {
  name?: string
  serviceTypeId?: string
  note?: string
  urgent?: boolean
}

/** `ClinicExamOrder`: visão da clínica, sem ids Vita. */
export interface ClinicExamOrder {
  id: string
  bookingKind: 'APPOINTMENT' | 'VISIT'
  bookingId: string
  name: string
  serviceTypeId?: string
  note?: string
  urgent: boolean
  status: ExamOrderStatus
  patientName: string
  patientBirthDate?: string
  consultationAt: string
  authorName: string
  cancelledAt?: string
  createdAt: string
}

/** `FamilyExamOrder`: visão do titular/tutor (sem conta autora). */
export interface FamilyExamOrder {
  id: string
  appointmentId: string
  clinicId: string
  clinicName: string
  name: string
  note?: string
  urgent: boolean
  status: ExamOrderStatus
  examinationId?: string
  orderedAt: string
}

/** Estados em pt-PT para a clínica e para o paciente (clinic-portal-v2 §5.5). */
export const EXAM_ORDER_STATUS_LABEL: Record<ExamOrderStatus, string> = {
  ORDERED: 'Pedido',
  SCHEDULED: 'Marcado',
  FULFILLED: 'Cumprido',
  CANCELLED: 'Cancelado',
}

/** `ClinicExamServiceTypeOption`: serviço de exame ativo da clínica, sem preço (BR-CLN-51). */
export interface ClinicExamServiceTypeOption {
  id: string
  name: string
  durationMinutes: number
}
