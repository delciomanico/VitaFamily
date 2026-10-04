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
  /**
   * TBD: “Especialidade” vem da especificação do frontend e não existe no domínio
   * (o domínio tem `reason`). Só UI e mocks até decisão por change control.
   */
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
}

/** Consulta pronta a mostrar, com o nome do membro. */
export interface AppointmentItem {
  appointment: Appointment
  memberName: string
}

/**
 * TBD (ver `specialty`): sugestões de especialidade no formulário; o utilizador pode escrever outra.
 */
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
