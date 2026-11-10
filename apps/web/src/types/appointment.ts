import type { ConfirmationStatus } from './clinic'

/** Consulta — categoria C5 (docs/04-domain/entities.md → Appointment). */
/** REQUESTED/REJECTED só em clínicas parceiras (D17): pedido → confirmada ou recusada pela clínica. */
export type AppointmentStatus = 'REQUESTED' | 'SCHEDULED' | 'REJECTED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'

export interface Appointment {
  id: string
  familyId: string
  memberId: string
  /** ISO UTC. */
  scheduledAt: string
  status: AppointmentStatus
  /** Especialidade (texto livre; sugestões em SPECIALTY_SUGGESTIONS). */
  specialty?: string
  professionalName?: string
  clinicId?: string
  /** Nome da clínica (texto de reserva, BR-CLN-02). */
  clinicName?: string
  reason?: string
  notes?: string
  /** Horário da clínica parceira onde foi pedida (D17). */
  slotId?: string
  /** Motivo indicado pela clínica ao recusar ou cancelar (D17). */
  responseNote?: string
  /** M14 Q (BR-CLN-25): ausente = PENDING ("Sem resposta"). Independente do estado da consulta. */
  confirmationStatus?: ConfirmationStatus
  /** M14 Q (BR-CLN-30): retorno sugerido pela clínica (yyyy-mm-dd); só leitura para a família. */
  followUpDueOn?: string
  /** Só no backend simulado (a API da família não os devolve): origem da confirmação e o dia. */
  confirmationSource?: 'PATIENT' | 'CLINIC'
  arrivedAt?: string
  startedAt?: string
  /** Só no mock: quando passou a SCHEDULED (BR-ALR-09: sem pedido a 48 h se marcada com menos). */
  scheduledSince?: string
  /** M15 S (BR-CLN-45): existe relatório FINAL partilhado e o actor é titular ou tutor. */
  reportAvailable?: boolean
  /** M15 U (BR-CLN-53): pedidos de exame não cancelados; 0 para quem não pode ler. */
  examOrderCount?: number
}

/** Resposta ao pedido de confirmação (`AppointmentConfirmationRequest`). */
export type ConfirmationResponse = 'GOING' | 'CANNOT'

/** Consulta pronta a mostrar, com o nome do membro. */
export interface AppointmentItem {
  appointment: Appointment
  memberName: string
}

/** Sugestões de especialidade no formulário; o utilizador pode escrever outra. */
export const SPECIALTY_SUGGESTIONS = [
  'Medicina geral',
  'Pediatria',
  'Cardiologia',
  'Ginecologia',
  'Dermatologia',
  'Oftalmologia',
  'Ortopedia',
  'Medicina dentária',
] as const
