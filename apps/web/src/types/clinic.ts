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

/**
 * Papéis do portal da clínica (authorization.md §6, D18): o Admin da clínica é criado pelo
 * Platform Admin e gere, por self-service, os Gestores da própria clínica.
 */
export type ClinicRole = 'CLINIC_ADMIN' | 'CLINIC_MANAGER'

/**
 * Conta do portal da clínica (`ClinicAccount`, ADR-020) — **não** é um `User`: outra tabela,
 * outro login, outra sessão, outro token. Uma pessoa que também use a app de família tem duas
 * identidades sem qualquer ligação entre si.
 */
export interface ClinicAccount {
  id: string
  clinicId: string
  email: string
  role: ClinicRole
  status: 'ACTIVE' | 'SUSPENDED'
}

/**
 * Sessão do portal no browser (o que a UI sabe depois de `POST /clinic-portal/auth/login`).
 * `ClinicTokenResponse` só devolve `clinicId` e `role`; `email` fica conhecido quando a sessão
 * nasce de um login nesta aba (não sobrevive a um `refresh` pelo cookie) e `clinicName` só existe
 * em modo demo — o contrato do portal não expõe o nome da clínica (ver clinicPortal.service.ts).
 */
export interface ClinicSession {
  clinicId: string
  role: ClinicRole
  email?: string
  clinicName?: string
}

/** Tipo de horário (D19): consulta ou exame. */
export type SlotKind = 'APPOINTMENT' | 'EXAM'

/** Horário publicado por uma clínica parceira (D17, BR-CLN-04). Em exames, `specialty` é o tipo de exame. */
export interface ClinicSlot {
  id: string
  clinicId: string
  kind: SlotKind
  /** Vagas do horário (BR-APT-11): sempre 1 em consultas. */
  capacity: number
  specialty: string
  professionalName?: string
  /** M14 (a1): profissional do catálogo; ausente nos horários manuais antigos. */
  professionalId?: string
  /** M14 (a1): serviço do catálogo. */
  serviceTypeId?: string
  /** M14 (a2): preenchido nos horários gerados por uma regra (não se removem individualmente). */
  scheduleRuleId?: string
  /** ISO UTC. */
  startsAt: string
  durationMinutes: number
}

/** Horário livre visto pela família ao marcar (com o nome da clínica). */
export interface AvailableSlot extends ClinicSlot {
  clinicName: string
  /** Vagas ainda livres. */
  remaining: number
}

/** Horário na área da clínica. Consulta: FREE|REQUESTED|SCHEDULED; exame: FREE|PARTIAL|FULL. */
export interface ClinicSlotView extends ClinicSlot {
  state: 'FREE' | 'REQUESTED' | 'SCHEDULED' | 'PARTIAL' | 'FULL'
  bookedCount: number
  remaining: number
}

/** `ClinicSlotBatchInput` (openapi.yaml): publicar várias horas de um dia. */
export interface PublishSlotsInput {
  kind: SlotKind
  /** Vagas por horário (1–50); só em exames. */
  capacity?: number
  /** Dia local (yyyy-mm-dd). */
  date: string
  /** Horas locais HH:mm. */
  times: string[]
  /** Obrigatório sem `serviceTypeId` (com serviço é o nome do serviço). */
  specialty?: string
  professionalName?: string
  /** M14 (a1): profissional ativo do catálogo (ativa deteção de sobreposição e bloqueios). */
  professionalId?: string
  /** M14 (a1): serviço ativo; `kind`, especialidade e duração vêm dele. */
  serviceTypeId?: string
  /** Obrigatório sem `serviceTypeId`. */
  durationMinutes?: number
}

/** Durações aceites por horário (BR-CLN-04). */
export const SLOT_DURATIONS = [15, 20, 30, 45, 60] as const

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

/** `ClinicRequestResponse` (openapi.yaml): confirmar ou recusar um pedido. */
export type ClinicRequestDecision = 'CONFIRM' | 'REJECT'

/** Medicamento da receita emitida pela clínica (`MedicationPlanInput`, openapi.yaml). */
export interface ClinicPrescriptionMedicationInput {
  name: string
  dosage: string
  /** Horas locais HH:mm (uma ou mais). */
  times: string[]
  /** Dias de tratamento a partir de hoje; ausente = uso contínuo (BR-MED-02). */
  durationDays?: number
  notes?: string
}

/** `PrescriptionInput` emitida pela clínica ao completar a consulta (BR-RX-07). */
export interface ClinicPrescriptionInput {
  /** Data ISO (yyyy-mm-dd). */
  issuedOn: string
  doctorName?: string
  notes?: string
  medications: ClinicPrescriptionMedicationInput[]
}

/** `ClinicCompleteAppointmentRequest` (openapi.yaml, D18/BR-CLN-06). */
export interface ClinicCompleteInput {
  /** Resultado da consulta, visível ao paciente. */
  outcomeNote?: string
  /** Receita opcional; se presente nasce com `issuedBy=CLINIC` (BR-RX-07). */
  prescription?: ClinicPrescriptionInput
}

/** Máximo de vagas por horário de exame (BR-APT-11). */
export const MAX_SLOT_CAPACITY = 50

/** Documento (PDF) de resultados carregado pela clínica, como a clínica o vê. */
export interface ClinicDocument {
  id: string
  originalName: string
  sizeBytes: number
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED'
}

/**
 * Exame marcado numa vaga, visto pela clínica (`ClinicExamBooking`): mínimo necessário
 * (BR-CLN-03) — nunca os valores dos resultados emitidos. O exame nasce SCHEDULED (ADR-023).
 */
export interface ClinicExamBooking {
  id: string
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  scheduledAt: string
  examType?: string
  patientName: string
  notes?: string
  responseNote?: string
  resultsCount: number
  documents: ClinicDocument[]
}

/** Parâmetro de resultado emitido pela clínica (`ExamResultInput`). */
export interface ClinicExamResultInput {
  parameter: string
  valueNumeric?: number
  valueText?: string
  unit?: string
  referenceMin?: number
  referenceMax?: number
}

/** `ClinicCompleteExaminationRequest` (BR-CLN-08): parâmetros e/ou PDF já carregado; sem interpretação (D11). */
export interface ClinicCompleteExamInput {
  results: ClinicExamResultInput[]
  resultNote?: string
}

// --- M14 (a1/a2): catálogo, regras de horário e bloqueios (BR-CLN-11..16) ---

/** `ClinicProfessional` (BR-CLN-11): não se apaga, desativa-se. */
export interface ClinicProfessional {
  id: string
  name: string
  specialty?: string
  active: boolean
}

export interface ClinicProfessionalInput {
  name: string
  specialty?: string
}

export interface ClinicProfessionalPatch {
  name?: string
  specialty?: string | null
  active?: boolean
}

/** `ClinicServiceType` (BR-CLN-11/12): preço em cêntimos, apenas informativo. */
export interface ClinicServiceType {
  id: string
  name: string
  kind: SlotKind
  durationMinutes: number
  /** Cêntimos (inteiro >= 0); ausente = sem preço. */
  priceMinor?: number
  /** Moeda da clínica (só leitura; AOA por omissão). */
  currency: string
  active: boolean
}

export interface ClinicServiceTypeInput {
  name: string
  kind: SlotKind
  durationMinutes: number
  priceMinor?: number
}

/** `kind` não é alterável (BR-CLN-12). */
export interface ClinicServiceTypePatch {
  name?: string
  durationMinutes?: number
  priceMinor?: number | null
  active?: boolean
}

/** `ClinicScheduleRule` (BR-CLN-12): horas locais da clínica, dias ISO (1 = segunda ... 7 = domingo). */
export interface ClinicScheduleRule {
  id: string
  professionalId: string
  serviceTypeId: string
  weekdays: number[]
  startTime: string
  endTime: string
  /** Dia local (yyyy-mm-dd); ausente = desde já. */
  validFrom?: string
  /** Dia local inclusivo; ausente = sem fim. */
  validUntil?: string
  capacity: number
  active: boolean
}

export interface ClinicScheduleRuleInput {
  professionalId: string
  serviceTypeId: string
  weekdays: number[]
  startTime: string
  endTime: string
  validFrom?: string
  validUntil?: string
  capacity?: number
}

/** `professionalId` e `serviceTypeId` são imutáveis. */
export interface ClinicScheduleRulePatch {
  weekdays?: number[]
  startTime?: string
  endTime?: string
  validFrom?: string | null
  validUntil?: string | null
  capacity?: number
  active?: boolean
}

/** `ClinicScheduleGeneration`: só contagens (BR-CLN-12/15). */
export interface ScheduleGeneration {
  created: number
  unchanged: number
  removed: number
  skippedOverlap: number
  skippedTimeOff: number
  keptBooked: number
}

/** `ClinicScheduleRuleResult`. */
export interface ScheduleRuleResult {
  rule: ClinicScheduleRule
  generation: ScheduleGeneration
}

/** `ClinicTimeOff` (BR-CLN-14): bloqueio/férias de um profissional. */
export interface ClinicTimeOff {
  id: string
  professionalId: string
  /** ISO UTC. */
  startsAt: string
  endsAt: string
  reason?: string
  /** Horários do bloqueio ainda com marcações ativas. */
  bookedSlotCount: number
}

export interface ClinicTimeOffInput {
  professionalId: string
  startsAt: string
  endsAt: string
  reason?: string
}

/** `ClinicTimeOffBookedSlot`: horário bloqueado com marcações ativas (sem dados do paciente). */
export interface TimeOffBookedSlot {
  slotId: string
  kind: SlotKind
  startsAt: string
  durationMinutes: number
  bookedCount: number
}

/** `ClinicTimeOffResult`. */
export interface TimeOffResult {
  timeOff: ClinicTimeOff
  removedSlots: number
  bookedSlots: TimeOffBookedSlot[]
}

/** Limites do catálogo (BR-CLN-11/12). */
export const MAX_CLINIC_PROFESSIONALS = 100
export const MAX_CLINIC_SERVICES = 100
export const MAX_CLINIC_RULES = 200
/** Janela rolante de geração (BR-CLN-12): hoje + 56 dias. */
export const SCHEDULE_HORIZON_DAYS = 56
