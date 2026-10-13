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

/** `ClinicSlotBatchInput` (openapi.yaml): publicar várias horas de um dia. */
export interface PublishSlotsInput {
  /** Dia local (yyyy-mm-dd). */
  date: string
  /** Horas locais HH:mm. */
  times: string[]
  specialty: string
  professionalName?: string
  durationMinutes: number
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
