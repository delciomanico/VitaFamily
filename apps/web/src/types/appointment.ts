/** Consulta — categoria C5 (docs/04-domain/entities.md → Appointment). */
export type AppointmentStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'

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
}
