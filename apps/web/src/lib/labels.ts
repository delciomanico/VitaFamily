import type { Tone } from '@/components/ui/Badge'
import type { SelectOption } from '@/components/ui/Select'
import type { AlertCategory, AlertItem, AlertType } from '@/types/alert'
import type { AppointmentStatus } from '@/types/appointment'
import type { ExaminationStatus } from '@/types/examination'
import type { DoseStatus, MedicationPlanStatus } from '@/types/medication'
import type { PrescriptionStatus } from '@/types/prescription'
import { RELATIONSHIPS, type FamilyRole, type Relationship } from '@/types/family'
import { BLOOD_TYPES, SEXES, type BloodType, type Sex } from '@/types/health'
import type { SharingCategory } from '@/types/sharing'

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

/** Categorias de partilha C2–C6 (C1 é sempre visível). */
export const sharingCategoryLabels: Record<SharingCategory, string> = {
  ALLERGIES: 'Alergias e tipo sanguíneo',
  CONDITIONS: 'Condições e histórico',
  MEDICATION: 'Medicação e receitas',
  APPOINTMENTS: 'Consultas',
  EXAMS: 'Exames',
}

export interface StatusLabel {
  label: string
  tone: Tone
}

export const appointmentStatus: Record<AppointmentStatus, StatusLabel> = {
  REQUESTED: { label: 'Aguarda confirmação', tone: 'warning' },
  SCHEDULED: { label: 'Agendada', tone: 'primary' },
  REJECTED: { label: 'Recusada', tone: 'danger' },
  COMPLETED: { label: 'Realizada', tone: 'success' },
  NO_SHOW: { label: 'Não compareceu', tone: 'warning' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
}

export const examinationStatus: Record<ExaminationStatus, StatusLabel> = {
  SCHEDULED: { label: 'Agendado', tone: 'primary' },
  COMPLETED: { label: 'Realizado', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
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

/** Título do alerta a partir da regra e do resumo da origem (sem dados clínicos, FR-ALR-07). */
export function alertTitle({
  type,
  ruleKey,
  sourceLabel,
}: Pick<AlertItem, 'type' | 'ruleKey' | 'sourceLabel'>): string {
  switch (type) {
    case 'MEDICATION_DUE':
      return ruleKey === 'dose.repeat' ? `Toma por confirmar: ${sourceLabel}` : `Hora de tomar ${sourceLabel}`
    case 'APPOINTMENT_REMINDER':
      return `Lembrete de consulta: ${sourceLabel}`
    case 'EXAM_REMINDER':
      return `Lembrete de exame: ${sourceLabel}`
    case 'APPOINTMENT_OUTCOME_REQUEST':
      return `Como correu a consulta de ${sourceLabel}?`
    case 'APPOINTMENT_CONFIRMED':
      return `Consulta confirmada: ${sourceLabel}`
    case 'APPOINTMENT_REJECTED':
      return `Pedido de consulta recusado: ${sourceLabel}`
    case 'APPOINTMENT_CANCELLED':
      return `Consulta cancelada: ${sourceLabel}`
  }
}

/** Grupo do centro de alertas de cada tipo (Medicamentos, Consultas, Exames, Acompanhamento). */
export const alertCategoryOf: Record<AlertType, AlertCategory> = {
  MEDICATION_DUE: 'MEDICATION',
  APPOINTMENT_REMINDER: 'APPOINTMENTS',
  APPOINTMENT_CONFIRMED: 'APPOINTMENTS',
  APPOINTMENT_REJECTED: 'APPOINTMENTS',
  APPOINTMENT_CANCELLED: 'APPOINTMENTS',
  EXAM_REMINDER: 'EXAMS',
  APPOINTMENT_OUTCOME_REQUEST: 'FOLLOW_UP',
}

export const alertCategoryLabels: Record<AlertCategory, string> = {
  MEDICATION: 'Medicamentos',
  APPOINTMENTS: 'Consultas',
  EXAMS: 'Exames',
  FOLLOW_UP: 'Acompanhamento',
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
