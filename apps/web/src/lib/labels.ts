import type { Tone } from '@/components/ui/Badge'
import type { SelectOption } from '@/components/ui/Select'
import type { AlertItem } from '@/types/alert'
import type { AppointmentStatus } from '@/types/appointment'
import type { DoseStatus, MedicationPlanStatus } from '@/types/medication'
import type { PrescriptionStatus } from '@/types/prescription'
import { RELATIONSHIPS, type FamilyRole, type Relationship } from '@/types/family'
import { BLOOD_TYPES, SEXES, type BloodType, type Sex } from '@/types/health'

/** Textos em pt-PT para valores do domínio. */

export const relationshipLabels: Record<Relationship, string> = {
  SELF: 'Eu',
  SPOUSE: 'Cônjuge',
  FATHER: 'Pai',
  MOTHER: 'Mãe',
  SON: 'Filho',
  DAUGHTER: 'Filha',
  SIBLING: 'Irmão/Irmã',
  GRANDPARENT: 'Avô/Avó',
  OTHER: 'Outro',
}

export const sexLabels: Record<Sex, string> = {
  FEMALE: 'Feminino',
  MALE: 'Masculino',
  UNSPECIFIED: 'Prefiro não indicar',
}

export const roleLabels: Record<FamilyRole, string> = {
  FAMILY_ADMIN: 'Administrador',
  FAMILY_MEMBER: 'Membro',
}

export interface StatusLabel {
  label: string
  tone: Tone
}

export const appointmentStatus: Record<AppointmentStatus, StatusLabel> = {
  SCHEDULED: { label: 'Agendada', tone: 'primary' },
  COMPLETED: { label: 'Realizada', tone: 'success' },
  NO_SHOW: { label: 'Não compareceu', tone: 'warning' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
}

export const prescriptionStatus: Record<PrescriptionStatus, StatusLabel> = {
  ACTIVE: { label: 'Ativa', tone: 'success' },
  COMPLETED: { label: 'Concluída', tone: 'neutral' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
}

export const medicationStatus: Record<MedicationPlanStatus, StatusLabel> = {
  ACTIVE: { label: 'Ativo', tone: 'success' },
  ENDED: { label: 'Terminado', tone: 'neutral' },
}

/** Estados de uma toma (BR-MED-04). */
export const doseStatus: Record<DoseStatus, StatusLabel> = {
  PENDING: { label: 'Por tomar', tone: 'neutral' },
  TAKEN: { label: 'Tomada', tone: 'success' },
  NOT_TAKEN: { label: 'Não tomada', tone: 'danger' },
  UNCONFIRMED: { label: 'Não confirmada', tone: 'warning' },
}

/** Título do alerta a partir do tipo e do resumo da origem. */
export function alertTitle({ type, sourceLabel }: Pick<AlertItem, 'type' | 'sourceLabel'>): string {
  switch (type) {
    case 'MEDICATION_DUE':
      return `Hora de tomar ${sourceLabel}`
    case 'APPOINTMENT_REMINDER':
      return `Lembrete de consulta: ${sourceLabel}`
    case 'EXAM_REMINDER':
      return `Lembrete de exame: ${sourceLabel}`
    case 'APPOINTMENT_OUTCOME_REQUEST':
      return `Como correu a consulta de ${sourceLabel}?`
  }
}

export function bloodTypeLabel(value: BloodType): string {
  return value === 'UNKNOWN' ? 'Não sei' : value
}

export const relationshipOptions: SelectOption[] = RELATIONSHIPS.filter((r) => r !== 'SELF').map((value) => ({
  value,
  label: relationshipLabels[value],
}))

export const sexOptions: SelectOption[] = SEXES.map((value) => ({ value, label: sexLabels[value] }))

export const bloodTypeOptions: SelectOption[] = BLOOD_TYPES.map((value) => ({
  value,
  label: bloodTypeLabel(value),
}))
