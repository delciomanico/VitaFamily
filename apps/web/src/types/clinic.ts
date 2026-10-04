/** Clínica parceira (global) ou privada da família (docs/04-domain/entities.md → Clinic). */
export interface Clinic {
  id: string
  type: 'PARTNER' | 'PRIVATE'
  familyId?: string
  name: string
  address?: string
  phone?: string
  email?: string
  status: 'ACTIVE' | 'ARCHIVED'
}

/** Horário publicado por uma clínica parceira (D17, BR-CLN-04). */
export interface ClinicSlot {
  id: string
  clinicId: string
  specialty: string
  professionalName?: string
  /** ISO UTC. */
  startsAt: string
  durationMinutes: number
}

/** Horário livre visto pela família ao marcar (com o nome da clínica). */
export interface AvailableSlot extends ClinicSlot {
  clinicName: string
}

/** Horário na área da clínica: livre, pedido ou confirmado. */
export interface ClinicSlotView extends ClinicSlot {
  state: 'FREE' | 'REQUESTED' | 'SCHEDULED'
}

/**
 * Marcação vista pela clínica: só os dados mínimos (BR-CLN-03) — sem família, membro
 * nem qualquer dado de saúde.
 */
export interface ClinicBooking {
  id: string
  status: 'REQUESTED' | 'SCHEDULED' | 'REJECTED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'
  scheduledAt: string
  specialty?: string
  professionalName?: string
  patientName: string
  notes?: string
  responseNote?: string
}
