/**
 * Tipos de MK4 (partilha de registos com prazo e visualização única; receita digital do profissional):
 * `/families/{f}/members/{m}/record-shares*` (tag «Record Sharing»), `/professional-portal/shares*` e
 * `/professional-portal/bookings/{id}/prescription*`. Alinhados com `docs/05-api/openapi.yaml`; a API devolve
 * `null` e a UI usa ausente (`undefined`). O conteúdo partilhado, o `participantLabel` e a idade são dado de
 * saúde potencial (BR-MKT-75): só existem em memória na página que os mostra; nunca em logs, armazenamento
 * local nem cache.
 */
import type { BookingProfessional } from './consultations'
import type { SpecialtyCategory } from './professional'

export type RecordShareCategory = 'ALLERGIES' | 'CONDITIONS' | 'MEDICATION' | 'APPOINTMENTS' | 'EXAMS'
export const RECORD_SHARE_CATEGORIES: RecordShareCategory[] = ['ALLERGIES', 'CONDITIONS', 'MEDICATION', 'APPOINTMENTS', 'EXAMS']

export type ShareValidity = 'H24' | 'D7' | 'D30' | 'UNTIL_CONSULTATION_END_PLUS_24H'
export const SHARE_VALIDITIES: ShareValidity[] = ['H24', 'D7', 'D30', 'UNTIL_CONSULTATION_END_PLUS_24H']

/** Estado visto pela API; `EXPIRED` é derivado de `expiresAt ≤ agora`. */
export type RecordShareStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CONSUMED'

export interface RecordShareOptions {
  bookingId: string
  professional: BookingProfessional
  professionalCategory: SpecialtyCategory
  allowedCategories: RecordShareCategory[]
  validities: Array<{ validity: ShareValidity; expiresAt: string; eligible: boolean }>
  viewOnceAllowed: boolean
  maxActive: number
  activeCount: number
}

export interface CreateRecordShareInput {
  bookingId: string
  categories: RecordShareCategory[]
  validity: ShareValidity
  viewOnce?: boolean
  clientRequestId?: string
}

/** Partilha vista pela família: sem conteúdo dos registos nem autoria. */
export interface RecordShare {
  id: string
  bookingId: string
  professional: BookingProfessional
  categories: RecordShareCategory[]
  validity: ShareValidity
  viewOnce: boolean
  status: RecordShareStatus
  expiresAt: string
  revokedAt?: string
  consumedAt?: string
  viewCount: number
  lastViewedAt?: string
  createdAt: string
}

/** Uma abertura bem-sucedida: quem (nome público), o quê (categorias) e quando. */
export interface RecordShareView {
  viewNo: number
  viewedAt: string
  professionalName: string
  categories: RecordShareCategory[]
}

/** Vista do profissional: nunca ids de família, membro nem utilizador; só o rótulo e metadados. */
export interface ProfessionalShare {
  id: string
  bookingId: string
  participantLabel: string
  categories: RecordShareCategory[]
  validity: ShareValidity
  viewOnce: boolean
  status: RecordShareStatus
  expiresAt: string
  openCount: number
  lastOpenedAt?: string
  canOpen: boolean
  createdAt: string
}

export interface ProfessionalShareQuery {
  status?: RecordShareStatus
  bookingId?: string
  cursor?: string
}

export interface SharedAllergy {
  name: string
  since?: string
}
export interface SharedCondition {
  name: string
  kind: 'CONDITION' | 'HISTORY'
  since?: string
  until?: string
}
export interface SharedMedication {
  name: string
  dosage: string
  startAt: string
  endAt?: string
  continuous: boolean
}
export interface SharedAppointment {
  scheduledAt: string
  status: 'REQUESTED' | 'SCHEDULED' | 'REJECTED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'
  specialty?: string
  professionalName?: string
}
export interface SharedExamResult {
  parameter: string
  valueNumeric?: number
  valueText?: string
  unit?: string
  referenceMin?: number
  referenceMax?: number
}
export interface SharedExam {
  name: string
  examDate: string
  status: 'SCHEDULED' | 'COMPLETED'
  results: SharedExamResult[]
}

export type SharedBloodType = 'A_POS' | 'A_NEG' | 'B_POS' | 'B_NEG' | 'AB_POS' | 'AB_NEG' | 'O_POS' | 'O_NEG' | 'UNKNOWN'

/** Resposta de abertura: as secções existem só para as categorias concedidas (omitidas, nunca `null`). */
export interface SharedRecordsView {
  shareId: string
  participantLabel: string
  /** Anos completos à data da abertura (OP-119); nunca a data de nascimento nem o nome. */
  ageYears: number
  openedAt: string
  expiresAt: string
  viewOnce: boolean
  /** A sobrepor visivelmente ao conteúdo em todas as aberturas (BR-MKT-72). */
  watermark: { professionalName: string; openedOn: string }
  allergies?: SharedAllergy[]
  bloodType?: SharedBloodType
  conditions?: SharedCondition[]
  medications?: SharedMedication[]
  appointments?: SharedAppointment[]
  examinations?: SharedExam[]
}

// ───── Receita digital (atrás de `DIGITAL_PRESCRIPTION_ENABLED`) ─────

/** `MedicationPlanInput` do contrato: texto livre, sem catálogo. */
export interface ProfessionalPrescriptionMedication {
  name: string
  dosage: string
  scheduleType: 'FIXED_TIMES' | 'INTERVAL'
  times?: string[]
  daysOfWeek?: number[]
  intervalHours?: number
  startAt: string
  endAt?: string
  continuous?: boolean
  notes?: string
}

export interface ProfessionalPrescriptionInput {
  notes?: string
  medications: ProfessionalPrescriptionMedication[]
}

/** O que o profissional emitiu: sem id da receita nem do membro. */
export interface ProfessionalPrescription {
  bookingId: string
  issuedOn: string
  notes?: string
  medications: ProfessionalPrescriptionMedication[]
  createdAt: string
}
