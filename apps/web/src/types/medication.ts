/** Plano de medicação — categoria C4 (docs/04-domain/entities.md → MedicationPlan). */
export type MedicationPlanStatus = 'ACTIVE' | 'ENDED'

export interface MedicationPlan {
  id: string
  familyId: string
  memberId: string
  prescriptionId?: string
  name: string
  dosage: string
  scheduleType: 'FIXED_TIMES' | 'INTERVAL'
  /** Horas locais HH:mm (FIXED_TIMES). */
  times?: string[]
  /** 1–7; vazio = todos os dias. */
  daysOfWeek?: number[]
  intervalHours?: number
  startAt: string
  endAt?: string
  continuous: boolean
  notes?: string
  status: MedicationPlanStatus
  endedAt?: string
}

/** Estados de uma toma (BR-MED-04). */
export type DoseStatus = 'PENDING' | 'TAKEN' | 'NOT_TAKEN' | 'UNCONFIRMED'

export interface DoseOccurrence {
  id: string
  familyId: string
  memberId: string
  planId: string
  scheduledAt: string
  status: DoseStatus
  actedAt?: string
}
