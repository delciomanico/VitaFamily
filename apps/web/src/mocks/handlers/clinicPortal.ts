import { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import type {
  ClinicAccount,
  ClinicBooking,
  ClinicCompleteExamInput,
  ClinicCompleteInput,
  ClinicExamBooking,
  ClinicRequestDecision,
  ClinicSession,
  ClinicSlot,
  ClinicSlotView,
  ClinicStaffInput,
  ClinicVisit,
  ClinicWalkInInput,
  PublishSlotsInput,
} from '@/types/clinic'
import type { ClinicRecommendation, RecommendationOrigin } from '@/types/recommendation'
import { RECOMMENDATION_MAX_LENGTH } from '@/types/recommendation'
import { MAX_SLOT_CAPACITY, SLOT_DURATIONS } from '@/types/clinic'
import type { SlotKind } from '@/types/clinic'
import type { Examination } from '@/types/examination'
import type { DocumentUpload } from '@/types/document'
import { memberName } from '../access'
import { raiseAlerts } from '../alertRules'
import { appointmentSlotTaken, bookingOf, examBookingsOf, expireRequests, notifyResponse, visitOf } from '../bookings'
import { linkMember, patientOfMember } from '../clinicPatients'
import { overlappingSlot, timeOffAt } from '../clinicSchedule'
import { deriveDayState, waitingMinutesOf } from '@/lib/clinicDay'
import { issuedReceiptOf } from '../clinicReceipts'
import {
  isDoctor,
  ownsAppointment,
  ownsExam,
  ownsVisit,
  recordClinicAudit,
  requireAdminAccount,
  requireAnyAccount,
  requireStaffAccount,
  scrubReceipt,
} from '../clinicRoles'
import { DEMO_PASSWORD } from '../data/users'
import type { MockClinicAccountRecord } from '../data/clinicAccounts'
import { db, newId } from '../db'
import { respond } from '../respond'
import { insertPrescription } from './medications'

/*
 * Portal da clínica parceira (`/clinic-portal/*`, D17/D18, ADR-020).
 *
 * As contas são `ClinicAccount` — espaço de identidade SEPARADO de `users`: outro login, outra
 * sessão, outro token. Nenhum handler aqui recebe `userId`, `familyId` ou `memberId`: a clínica
 * resolve-se sempre pela sessão (`clinicAccountId`), como na API real (authorization.md §6.1).
 *
 * A clínica só vê as marcações da própria clínica, com os dados mínimos (BR-CLN-03): nunca
 * família, membro, nem dados de saúde.
 */

/** Conta ativa da sessão; sem sessão válida → UNAUTHENTICATED (INVALID_CREDENTIALS na UI). */
export const requireAccount = requireAnyAccount

/** Só o Admin da clínica gere as contas da própria clínica (BR-CLN-05). */
const requireAdmin = requireAdminAccount

function clinicNameOf(clinicId: string): string | undefined {
  return db.clinics.find((c) => c.id === clinicId && c.type === 'PARTNER')?.name
}

function toSession(account: MockClinicAccountRecord): ClinicSession {
  return {
    clinicId: account.clinicId,
    role: account.role,
    professionalId: account.professionalId,
    email: account.email,
    clinicName: clinicNameOf(account.clinicId),
  }
}

function toPublicAccount({ id, clinicId, email, role, professionalId, status }: MockClinicAccountRecord): ClinicAccount {
  return { id, clinicId, email, role, ...(professionalId ? { professionalId } : {}), status }
}

/** `ClinicBooking`: mínimo necessário (BR-CLN-03). */
export function toBooking(appointment: Appointment, now: Date = new Date()): ClinicBooking {
  return {
    id: appointment.id,
    status: appointment.status,
    scheduledAt: appointment.scheduledAt,
    specialty: appointment.specialty,
    professionalName: appointment.professionalName,
    patientName: memberName(appointment.memberId),
    notes: appointment.notes,
    responseNote: appointment.responseNote,
    source: 'VITA',
    clinicPatientId: appointment.clinicId ? patientOfMember(appointment.clinicId, appointment.memberId)?.id : undefined,
    slotId: appointment.slotId,
    ...dayFields(appointment, now),
    receiptId: issuedReceiptOf('APPOINTMENT', appointment.id)?.id,
  }
}

/** Confirmação, estado do dia e retorno (M14 Q, BR-CLN-25/28/30), comuns a consultas e visitas. */
function dayFields(
  booking: Pick<
    Appointment,
    'status' | 'confirmationStatus' | 'confirmationSource' | 'arrivedAt' | 'startedAt' | 'followUpDueOn'
  >,
  now: Date,
): Pick<
  ClinicBooking,
  | 'confirmationStatus'
  | 'confirmationSource'
  | 'dayState'
  | 'arrivedAt'
  | 'startedAt'
  | 'waitingMinutes'
  | 'followUpDueOn'
> {
  return {
    confirmationStatus: booking.confirmationStatus ?? 'PENDING',
    confirmationSource: booking.confirmationSource,
    dayState: deriveDayState(booking.status, booking.arrivedAt, booking.startedAt),
    arrivedAt: booking.arrivedAt,
    startedAt: booking.startedAt,
    waitingMinutes: waitingMinutesOf(booking.arrivedAt, booking.startedAt, now) ?? undefined,
    followUpDueOn: booking.followUpDueOn,
  }
}

/** Visita presencial só da clínica (BR-CLN-18 c): `patientName` é o do paciente da clínica. */
export function toVisitBooking(visit: ClinicVisit, now: Date = new Date()): ClinicBooking {
  return {
    id: visit.id,
    status: visit.status,
    scheduledAt: visit.scheduledAt,
    specialty: visit.specialty,
    professionalName: visit.professionalName,
    patientName: db.clinicPatients.find((p) => p.id === visit.clinicPatientId)?.name ?? '',
    notes: visit.notes,
    responseNote: visit.responseNote,
    source: 'MANUAL',
    clinicPatientId: visit.clinicPatientId,
    slotId: visit.slotId,
    ...dayFields(visit, now),
    receiptId: issuedReceiptOf('VISIT', visit.id)?.id,
  }
}

function findVisit(clinicId: string, id: string) {
  return db.clinicVisits.find((v) => v.id === id && v.clinicId === clinicId)
}

/** Marcação desta clínica; de outra clínica → NOT_FOUND (sem enumeração). */
function findBooking(clinicId: string, id: string): Appointment {
  const appointment = db.appointments.find((a) => a.id === id && a.clinicId === clinicId)
  if (!appointment) throw new AppError('NOT_FOUND')
  return appointment
}

const byScheduledAt = (a: ClinicBooking, b: ClinicBooking) => a.scheduledAt.localeCompare(b.scheduledAt)

// --- Sessão (`/clinic-portal/auth/*`) ---

/**
 * Sessão do mock: em vez do par access/refresh token da API real, a UI guarda o
 * `clinicAccountId` (como a sessão de `User` no mock guarda o `userId`) e passa-o a cada handler.
 */
export interface MockClinicLoginResult extends ClinicSession {
  clinicAccountId: string
}

/** `POST /clinic-portal/auth/login`. */
export function clinicLogin(email: string, password: string) {
  return respond((): MockClinicLoginResult => {
    const account = db.clinicAccounts.find((a) => a.email === email.trim().toLowerCase())
    if (!account || account.password !== password) throw new AppError('INVALID_CREDENTIALS')
    if (account.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED')
    recordClinicAudit(account, 'CLINIC_ACCOUNT_LOGIN', 'ClinicAccount', account.id)
    return { clinicAccountId: account.id, ...toSession(account) }
  })
}

/** `POST /clinic-portal/auth/refresh` (no mock: retoma a sessão guardada na aba). */
export function clinicRefresh(clinicAccountId: string) {
  return respond((): MockClinicLoginResult | null => {
    const account = db.clinicAccounts.find((a) => a.id === clinicAccountId && a.status === 'ACTIVE')
    return account ? { clinicAccountId: account.id, ...toSession(account) } : null
  })
}

// --- Hierarquia de staff (`/clinic-portal/staff`, BR-CLN-05/39) ---

const STAFF_ROLES: ClinicAccount['role'][] = ['CLINIC_MANAGER', 'CLINIC_DOCTOR']

/** `GET /clinic-portal/staff`: Gestores e Médicos da própria clínica (nunca os de outra). */
export function listClinicStaff(clinicAccountId: string) {
  return respond((): ClinicAccount[] => {
    const admin = requireAdmin(clinicAccountId)
    return db.clinicAccounts
      .filter((a) => a.clinicId === admin.clinicId && STAFF_ROLES.includes(a.role))
      .map(toPublicAccount)
      .sort((a, b) => a.email.localeCompare(b.email, 'pt-PT'))
  })
}

/**
 * `POST /clinic-portal/staff`: cria um `CLINIC_MANAGER` (omissão) ou um `CLINIC_DOCTOR` (BR-CLN-05/39).
 * O Médico exige `professionalId` de um profissional ativo da própria clínica (outro → `NOT_FOUND`),
 * ainda sem conta Médico (`CONFLICT`); o Gestor com `professionalId` → `VALIDATION_ERROR`. Na API
 * real a palavra-passe inicial vai por e-mail; no modo demo é a palavra-passe de demonstração.
 */
export function createClinicStaff(clinicAccountId: string, input: ClinicStaffInput | string) {
  return respond((): ClinicAccount => {
    const admin = requireAdmin(clinicAccountId)
    const { email, role = 'CLINIC_MANAGER', professionalId } = typeof input === 'string' ? { email: input } : input
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AppError('VALIDATION_ERROR')
    if (role !== 'CLINIC_MANAGER' && role !== 'CLINIC_DOCTOR') throw new AppError('VALIDATION_ERROR')
    if (role === 'CLINIC_MANAGER' && professionalId) throw new AppError('VALIDATION_ERROR')
    if (role === 'CLINIC_DOCTOR') {
      if (!professionalId) throw new AppError('VALIDATION_ERROR')
      const professional = db.professionals.find(
        (p) => p.id === professionalId && p.clinicId === admin.clinicId && p.active,
      )
      if (!professional) throw new AppError('NOT_FOUND')
      if (db.clinicAccounts.some((a) => a.role === 'CLINIC_DOCTOR' && a.professionalId === professionalId)) {
        throw new AppError('CONFLICT')
      }
    }
    if (db.clinicAccounts.some((a) => a.email === address)) throw new AppError('VALIDATION_ERROR')
    const account: MockClinicAccountRecord = {
      id: newId('cac'),
      clinicId: admin.clinicId,
      email: address,
      password: DEMO_PASSWORD,
      role,
      ...(role === 'CLINIC_DOCTOR' ? { professionalId } : {}),
      status: 'ACTIVE',
    }
    db.clinicAccounts.push(account)
    recordClinicAudit(admin, 'CLINIC_STAFF_CREATE', 'ClinicAccount', account.id)
    return toPublicAccount(account)
  })
}

/** `DELETE /clinic-portal/staff/{clinicAccountId}`: só remove Gestores e Médicos da própria clínica. */
export function removeClinicStaff(clinicAccountId: string, targetId: string) {
  return respond(() => {
    const admin = requireAdmin(clinicAccountId)
    const target = db.clinicAccounts.find(
      (a) => a.id === targetId && a.clinicId === admin.clinicId && STAFF_ROLES.includes(a.role),
    )
    if (!target) throw new AppError('NOT_FOUND')
    db.clinicAccounts = db.clinicAccounts.filter((a) => a.id !== targetId)
    recordClinicAudit(admin, 'CLINIC_STAFF_REMOVE', 'ClinicAccount', targetId)
    // A conta removida deixa de ser identificável na auditoria (anonimização, BR-AUD-02).
    for (const entry of db.clinicAudit) if (entry.actorAccountId === targetId) entry.actorAccountId = null
    for (const receipt of db.clinicReceipts) {
      if (receipt.issuedByClinicAccountId === targetId) receipt.issuedByClinicAccountId = null
      if (receipt.voidedByClinicAccountId === targetId) receipt.voidedByClinicAccountId = null
    }
  })
}

// --- Horários (`/clinic-portal/slots`, BR-CLN-04) ---

/** Ocupação e estado de um horário (BR-APT-11): consulta FREE|REQUESTED|SCHEDULED, exame FREE|PARTIAL|FULL. */
function toSlotView(slot: ClinicSlot): ClinicSlotView {
  if (slot.kind === 'EXAM') {
    const bookedCount = examBookingsOf(slot.id).length
    const remaining = slot.capacity - bookedCount
    return { ...slot, bookedCount, remaining, state: bookedCount === 0 ? 'FREE' : remaining === 0 ? 'FULL' : 'PARTIAL' }
  }
  const booking = bookingOf(slot.id)
  const taken = booking !== undefined || visitOf(slot.id) !== undefined
  return {
    ...slot,
    bookedCount: taken ? 1 : 0,
    remaining: taken ? 0 : 1,
    state: booking?.status === 'REQUESTED' ? 'REQUESTED' : taken ? 'SCHEDULED' : 'FREE',
  }
}

/** `GET /clinic-portal/slots?kind`: horários futuros da clínica, com a ocupação de cada um (UC-CLN-04). */
export function listOwnClinicSlots(clinicAccountId: string, kind?: SlotKind, now: Date = new Date()) {
  return respond((): ClinicSlotView[] => {
    const { clinicId } = requireStaffAccount(clinicAccountId)
    expireRequests(now)
    return db.slots
      .filter(
        (slot) =>
          slot.clinicId === clinicId && (!kind || slot.kind === kind) && Date.parse(slot.startsAt) > now.getTime(),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.specialty.localeCompare(b.specialty))
      .map(toSlotView)
  })
}

/**
 * `POST /clinic-portal/slots`: publicar horários num dia; ignora horas passadas e duplicadas.
 * M14: com `professionalId`/`serviceTypeId` usa o catálogo (o serviço dá tipo, nome e duração) e
 * qualquer sobreposição do profissional ou bloqueio → `CONFLICT`, sem criar nada (BR-CLN-13/14).
 */
export function publishClinicSlots(clinicAccountId: string, input: PublishSlotsInput, now: Date = new Date()) {
  return respond((): ClinicSlot[] => {
    const { clinicId } = requireStaffAccount(clinicAccountId)
    const professional = input.professionalId
      ? db.professionals.find((p) => p.id === input.professionalId && p.clinicId === clinicId)
      : undefined
    if (input.professionalId && !professional) throw new AppError('NOT_FOUND')
    const service = input.serviceTypeId
      ? db.services.find((s) => s.id === input.serviceTypeId && s.clinicId === clinicId)
      : undefined
    if (input.serviceTypeId && !service) throw new AppError('NOT_FOUND')
    if ((professional && !professional.active) || (service && !service.active)) throw new AppError('CONFLICT')
    if (service) {
      const differs =
        input.kind !== service.kind ||
        (input.durationMinutes !== undefined && input.durationMinutes !== service.durationMinutes) ||
        (input.specialty?.trim() && input.specialty.trim() !== service.name)
      if (differs) throw new AppError('VALIDATION_ERROR')
    }
    const specialty = service ? service.name : (input.specialty ?? '').trim()
    const durationMinutes = service ? service.durationMinutes : input.durationMinutes
    const professionalName = professional ? professional.name : input.professionalName?.trim() || undefined
    const capacity = input.capacity ?? 1
    if (!specialty || input.times.length === 0 || durationMinutes === undefined) throw new AppError('VALIDATION_ERROR')
    if (!(SLOT_DURATIONS as readonly number[]).includes(durationMinutes)) throw new AppError('VALIDATION_ERROR')
    // BR-APT-11: vagas 1–50, e só os horários de exame podem ter mais de uma.
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SLOT_CAPACITY) throw new AppError('VALIDATION_ERROR')
    if (input.kind === 'APPOINTMENT' && capacity > 1) throw new AppError('VALIDATION_ERROR')

    const planned: Array<{ startsAt: Date; iso: string; duplicate: boolean }> = []
    for (const time of input.times) {
      const startsAt = new Date(`${input.date}T${time}`)
      if (Number.isNaN(startsAt.getTime())) throw new AppError('VALIDATION_ERROR')
      const iso = startsAt.toISOString()
      const duplicate = db.slots.some(
        (s) =>
          s.clinicId === clinicId &&
          s.kind === input.kind &&
          s.startsAt === iso &&
          s.professionalName === professionalName &&
          s.specialty === specialty &&
          (!professional || s.durationMinutes === durationMinutes),
      )
      if (startsAt.getTime() <= now.getTime()) continue
      if (professional && !duplicate) {
        // BR-CLN-13/14: nada é criado se alguma hora colidir.
        if (overlappingSlot(db, professional.id, iso, durationMinutes)) throw new AppError('CONFLICT')
        if (timeOffAt(db, professional.id, iso, durationMinutes)) throw new AppError('CONFLICT')
      }
      planned.push({ startsAt, iso, duplicate })
    }
    // Horas pedidas na mesma chamada não se podem sobrepor entre si (mesmo profissional).
    if (professional) {
      const fresh = planned.filter((p) => !p.duplicate).map((p) => p.startsAt.getTime()).sort((a, b) => a - b)
      for (let i = 1; i < fresh.length; i++) {
        if (fresh[i]! < fresh[i - 1]! + durationMinutes * 60_000) throw new AppError('CONFLICT')
      }
    }

    const created: ClinicSlot[] = []
    for (const { iso, duplicate } of planned) {
      if (duplicate) continue
      const slot: ClinicSlot = {
        id: newId('slot'),
        clinicId,
        kind: input.kind,
        capacity,
        specialty,
        professionalName,
        professionalId: professional?.id,
        serviceTypeId: service?.id,
        startsAt: iso,
        durationMinutes,
      }
      db.slots.push(slot)
      created.push(slot)
    }
    return created
  })
}

/** `PATCH /clinic-portal/slots/{slotId}`: altera as vagas de um horário de exame (BR-APT-11). */
export function updateClinicSlotCapacity(clinicAccountId: string, slotId: string, capacity: number) {
  return respond((): ClinicSlotView => {
    const { clinicId } = requireStaffAccount(clinicAccountId)
    const slot = db.slots.find((s) => s.id === slotId && s.clinicId === clinicId)
    if (!slot) throw new AppError('NOT_FOUND')
    if (slot.kind !== 'EXAM' || !Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SLOT_CAPACITY) {
      throw new AppError('VALIDATION_ERROR')
    }
    if (capacity < examBookingsOf(slot.id).length) throw new AppError('CONFLICT')
    slot.capacity = capacity
    return toSlotView(slot)
  })
}

/** `DELETE /clinic-portal/slots/{slotId}`: só horários sem marcação ativa (BR-CLN-04). */
export function removeClinicSlot(clinicAccountId: string, slotId: string) {
  return respond(() => {
    const { clinicId } = requireStaffAccount(clinicAccountId)
    const slot = db.slots.find((s) => s.id === slotId && s.clinicId === clinicId)
    if (!slot) throw new AppError('NOT_FOUND')
    // Gerado por regra: não se remove individualmente (BR-CLN-12); usar bloqueio ou desativar a regra.
    if (slot.scheduleRuleId) throw new AppError('CONFLICT')
    if (appointmentSlotTaken(slot.id) || examBookingsOf(slot.id).length > 0) throw new AppError('CONFLICT')
    db.slots = db.slots.filter((s) => s.id !== slotId)
  })
}

// --- Pedidos (`/clinic-portal/requests`, UC-CLN-05) ---

/** `GET /clinic-portal/requests`: só os pedidos por responder (`REQUESTED`). */
export function listClinicRequests(clinicAccountId: string, now: Date = new Date()) {
  return respond((): ClinicBooking[] => {
    const { clinicId } = requireStaffAccount(clinicAccountId)
    expireRequests(now)
    return db.appointments
      .filter((a) => a.clinicId === clinicId && a.status === 'REQUESTED')
      .map((a) => toBooking(a, now))
      .sort(byScheduledAt)
  })
}

/** `PUT /clinic-portal/requests/{appointmentId}`: confirmar (AGENDADA) ou recusar (RECUSADA). */
export function respondClinicRequest(
  clinicAccountId: string,
  appointmentId: string,
  decision: ClinicRequestDecision,
  note?: string,
  now: Date = new Date(),
) {
  return respond((): ClinicBooking => {
    const { clinicId } = requireStaffAccount(clinicAccountId)
    expireRequests(now)
    const appointment = findBooking(clinicId, appointmentId)
    if (appointment.status !== 'REQUESTED') throw new AppError('CONFLICT')
    appointment.status = decision === 'CONFIRM' ? 'SCHEDULED' : 'REJECTED'
    if (decision === 'CONFIRM') appointment.scheduledSince = now.toISOString()
    // O motivo só é relevante na recusa (`ClinicRequestResponse`).
    if (decision === 'REJECT') appointment.responseNote = note?.trim() || undefined
    notifyResponse(appointment, now.toISOString())
    return toBooking(appointment)
  })
}

// --- Agenda (`/clinic-portal/agenda`, UC-CLN-06) ---

/** Estados que a agenda da clínica mostra (confirmadas e os seus desfechos). */
const AGENDA_STATUSES: Appointment['status'][] = ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']

/** `GET /clinic-portal/agenda`: consultas confirmadas da própria clínica, por ordem cronológica. */
export function listClinicAgenda(clinicAccountId: string, now: Date = new Date()) {
  return respond((): ClinicBooking[] => {
    const account = requireAccount(clinicAccountId)
    const { clinicId } = account
    expireRequests(now)
    return [
      ...db.appointments
        .filter((a) => a.clinicId === clinicId && AGENDA_STATUSES.includes(a.status) && ownsAppointment(account, a))
        .map((a) => scrubReceipt(account, toBooking(a, now))),
      // BR-CLN-18/23: as visitas presenciais manuais também aparecem na agenda.
      ...db.clinicVisits
        .filter((v) => v.clinicId === clinicId && ownsVisit(account, v))
        .map((v) => scrubReceipt(account, toVisitBooking(v, now))),
    ].sort(byScheduledAt)
  })
}

/** `PUT /clinic-portal/agenda/{appointmentId}/cancel`: futura e confirmada, com motivo obrigatório. */
export function cancelClinicAppointment(
  clinicAccountId: string,
  appointmentId: string,
  note: string,
  now: Date = new Date(),
) {
  return respond((): ClinicBooking => {
    const account = requireStaffAccount(clinicAccountId)
    const { clinicId } = account
    const visit = findVisit(clinicId, appointmentId)
    if (visit) {
      if (!note.trim()) throw new AppError('VALIDATION_ERROR')
      if (visit.status !== 'SCHEDULED' || Date.parse(visit.scheduledAt) <= now.getTime()) throw new AppError('CONFLICT')
      visit.status = 'CANCELLED'
      visit.responseNote = note.trim()
      return toVisitBooking(visit)
    }
    const appointment = findBooking(clinicId, appointmentId)
    if (!note.trim()) throw new AppError('VALIDATION_ERROR')
    if (appointment.status !== 'SCHEDULED' || Date.parse(appointment.scheduledAt) <= now.getTime()) {
      throw new AppError('CONFLICT')
    }
    appointment.status = 'CANCELLED'
    appointment.responseNote = note.trim()
    notifyResponse(appointment, now.toISOString())
    recordClinicAudit(account, 'CLINIC_CANCEL', 'Appointment', appointment.id)
    return toBooking(appointment)
  })
}

/**
 * `PUT /clinic-portal/agenda/{appointmentId}/complete` (D18, BR-CLN-06/BR-RX-07): a consulta em
 * curso passa a REALIZADA, com o resultado e — opcionalmente — a receita, que nasce com
 * `issuedBy=CLINIC` e passa a aparecer no histórico do paciente.
 */
export function completeClinicAppointment(
  clinicAccountId: string,
  appointmentId: string,
  input: ClinicCompleteInput,
  now: Date = new Date(),
) {
  return respond((): ClinicBooking => {
    const account = requireAccount(clinicAccountId)
    const { clinicId } = account
    const visit = findVisit(clinicId, appointmentId)
    if (visit && !ownsVisit(account, visit)) throw new AppError('NOT_FOUND')
    if (visit) {
      // Visita manual: só `outcomeNote`, sem receita (BR-CLN-18).
      if (visit.status !== 'SCHEDULED' || input.prescription) {
        throw new AppError(visit.status !== 'SCHEDULED' ? 'CONFLICT' : 'VALIDATION_ERROR')
      }
      visit.status = 'COMPLETED'
      visit.outcomeNote = input.outcomeNote?.trim() || undefined
      recordClinicAudit(account, 'CLINIC_COMPLETE', 'ClinicVisit', visit.id)
      return scrubReceipt(account, toVisitBooking(visit))
    }
    const appointment = findBooking(clinicId, appointmentId)
    if (!ownsAppointment(account, appointment)) throw new AppError('NOT_FOUND')
    // Só a consulta em curso: nunca completa duas vezes nem uma que não esteja confirmada (ST4).
    if (appointment.status !== 'SCHEDULED') throw new AppError('CONFLICT')

    if (input.prescription) {
      const { prescription } = input
      insertPrescription(
        appointment.familyId,
        {
          memberId: appointment.memberId,
          issuedOn: prescription.issuedOn,
          doctorName: prescription.doctorName,
          clinicName: clinicNameOf(clinicId),
          notes: prescription.notes,
          medications: prescription.medications.map((medication) => ({
            name: medication.name,
            dosage: medication.dosage,
            scheduleType: 'FIXED_TIMES',
            times: medication.times,
            continuous: medication.durationDays === undefined,
            durationDays: medication.durationDays,
            notes: medication.notes,
          })),
          documents: [],
        },
        now,
        { issuedBy: 'CLINIC', appointmentId },
      )
    }

    appointment.status = 'COMPLETED'
    const outcomeNote = input.outcomeNote?.trim()
    if (outcomeNote) {
      db.appointmentOutcomes.push({ appointmentId, outcomeNote, recordedAt: now.toISOString() })
    }
    recordClinicAudit(account, 'CLINIC_COMPLETE', 'Appointment', appointment.id)
    return scrubReceipt(account, toBooking(appointment))
  })
}

// --- Agenda de exames (`/clinic-portal/exam-agenda`, ADR-023) ---

/** `ClinicExamBooking`: mínimo necessário (BR-CLN-03); nunca os valores dos resultados. */
export function toExamBooking(exam: Examination): ClinicExamBooking {
  const slot = db.slots.find((s) => s.id === exam.slotId)
  const results = db.examResults.filter((r) => r.examinationId === exam.id)
  return {
    id: exam.id,
    status: exam.status,
    scheduledAt: slot?.startsAt ?? exam.examDate,
    examType: exam.name,
    patientName: memberName(exam.memberId),
    notes: exam.notes,
    responseNote: exam.responseNote,
    resultsCount: results.length,
    documents: db.documents
      .filter((d) => d.resourceType === 'EXAMINATION' && d.resourceId === exam.id && d.uploadedByClinic)
      .map((d) => ({ id: d.id, originalName: d.originalName, sizeBytes: d.sizeBytes, scanStatus: d.scanStatus ?? 'CLEAN' })),
    receiptId: issuedReceiptOf('EXAM', exam.id)?.id,
  }
}

/** Exame desta clínica marcado num dos seus horários; de outra → NOT_FOUND (sem enumeração). */
function findExam(account: MockClinicAccountRecord, id: string): Examination {
  const exam = db.examinations.find((e) => e.id === id && e.slotId && e.clinicId === account.clinicId)
  if (!exam || !ownsExam(account, exam)) throw new AppError('NOT_FOUND')
  return exam
}

const byExamTime = (a: ClinicExamBooking, b: ClinicExamBooking) => a.scheduledAt.localeCompare(b.scheduledAt)

/** `GET /clinic-portal/exam-agenda`: exames marcados nos horários da clínica, por ordem cronológica. */
export function listClinicExamAgenda(clinicAccountId: string) {
  return respond((): ClinicExamBooking[] => {
    const account = requireAccount(clinicAccountId)
    return db.examinations
      .filter((e) => e.slotId && e.clinicId === account.clinicId && ownsExam(account, e))
      .map((e) => scrubReceipt(account, toExamBooking(e)))
      .sort(byExamTime)
  })
}

/** `PUT /clinic-portal/exam-agenda/{id}/cancel`: exame SCHEDULED, com motivo; liberta a vaga. */
export function cancelClinicExam(clinicAccountId: string, examinationId: string, note: string) {
  return respond((): ClinicExamBooking => {
    const account = requireStaffAccount(clinicAccountId)
    const exam = findExam(account, examinationId)
    if (!note.trim()) throw new AppError('VALIDATION_ERROR')
    if (exam.status !== 'SCHEDULED') throw new AppError('CONFLICT')
    exam.status = 'CANCELLED'
    exam.responseNote = note.trim()
    return toExamBooking(exam)
  })
}

/** `POST /clinic-portal/exam-agenda/{id}/documents`: PDF dos resultados (BR-CLN-08). */
export function uploadClinicExamDocument(clinicAccountId: string, examinationId: string, upload: DocumentUpload) {
  return respond((): ClinicExamBooking => {
    const account = requireAccount(clinicAccountId)
    const exam = findExam(account, examinationId)
    if (exam.status === 'CANCELLED' || upload.mimeType !== 'application/pdf') throw new AppError('VALIDATION_ERROR')
    db.documents.push({
      ...upload,
      id: newId('doc'),
      familyId: exam.familyId,
      memberId: exam.memberId,
      resourceType: 'EXAMINATION',
      resourceId: exam.id,
      createdAt: new Date().toISOString(),
      scanStatus: 'CLEAN',
      uploadedByClinic: true,
    })
    return scrubReceipt(account, toExamBooking(exam))
  })
}

/**
 * `PUT /clinic-portal/exam-agenda/{id}/complete` (BR-CLN-08, D11): grava os parâmetros e passa o
 * exame a COMPLETED; exige pelo menos um parâmetro ou um PDF já carregado. Sem interpretação.
 */
export function completeClinicExam(
  clinicAccountId: string,
  examinationId: string,
  input: ClinicCompleteExamInput,
  now: Date = new Date(),
) {
  return respond((): ClinicExamBooking => {
    const account = requireAccount(clinicAccountId)
    const exam = findExam(account, examinationId)
    if (exam.status !== 'SCHEDULED') throw new AppError('CONFLICT')
    const hasPdf = toExamBooking(exam).documents.length > 0
    if (input.results.length === 0 && !hasPdf) throw new AppError('VALIDATION_ERROR')
    for (const result of input.results) {
      const hasValue = result.valueNumeric !== undefined || Boolean(result.valueText?.trim())
      const { referenceMin: min, referenceMax: max } = result
      if (!result.parameter.trim() || !hasValue || (min !== undefined && max !== undefined && min > max)) {
        throw new AppError('VALIDATION_ERROR')
      }
      db.examResults.push({
        id: newId('res'),
        examinationId: exam.id,
        parameter: result.parameter.trim(),
        valueNumeric: result.valueNumeric,
        valueText: result.valueText?.trim() || undefined,
        unit: result.unit?.trim() || undefined,
        referenceMin: min,
        referenceMax: max,
        createdAt: now.toISOString(),
      })
    }
    exam.status = 'COMPLETED'
    exam.responseNote = input.resultNote?.trim() || exam.responseNote
    recordClinicAudit(account, 'EXAM_CLINIC_COMPLETE', 'Examination', exam.id)
    return scrubReceipt(account, toExamBooking(exam))
  })
}

// --- Recomendações (`/clinic-portal/recommendations`, BR-CLN-09) ---

/** `POST /clinic-portal/recommendations`: nota ligada a uma consulta (SCHEDULED/COMPLETED) ou exame (não cancelado) da clínica. */
export function createClinicRecommendation(
  clinicAccountId: string,
  input: RecommendationOrigin & { text: string },
  now: Date = new Date(),
) {
  return respond((): ClinicRecommendation => {
    const account = requireAccount(clinicAccountId)
    const { clinicId } = account
    const text = input.text.trim()
    const appointmentId = 'appointmentId' in input ? input.appointmentId : undefined
    const examinationId = 'examinationId' in input ? input.examinationId : undefined
    if (!text || text.length > RECOMMENDATION_MAX_LENGTH || Boolean(appointmentId) === Boolean(examinationId)) {
      throw new AppError('VALIDATION_ERROR')
    }
    const origin = appointmentId
      ? db.appointments.find((a) => a.id === appointmentId && a.clinicId === clinicId)
      : db.examinations.find((e) => e.id === examinationId && e.slotId && e.clinicId === clinicId)
    if (!origin) throw new AppError('NOT_FOUND')
    if (appointmentId ? !ownsAppointment(account, origin as Appointment) : !ownsExam(account, origin as Examination)) {
      throw new AppError('NOT_FOUND')
    }
    if (origin.status !== 'SCHEDULED' && origin.status !== 'COMPLETED') throw new AppError('CONFLICT')
    const recommendation = {
      id: newId('rec'),
      familyId: origin.familyId,
      memberId: origin.memberId,
      appointmentId,
      examinationId,
      clinicId,
      clinicName: origin.clinicName ?? clinicNameOf(clinicId) ?? 'Clínica',
      text,
      createdAt: now.toISOString(),
    }
    db.recommendations.push(recommendation)
    // O paciente é avisado, sem o texto (BR-CLN-09).
    raiseAlerts(db, [
      {
        familyId: origin.familyId,
        memberId: origin.memberId,
        type: 'RECOMMENDATION_ADDED',
        ruleKey: 'recommendation.added',
        sourceType: 'RECOMMENDATION',
        sourceId: recommendation.id,
        triggerAt: now.toISOString(),
        occurrence: recommendation.id,
      },
    ])
    return toClinicRecommendation(recommendation)
  })
}

/** O Médico só vê as recomendações das suas marcações (BR-CLN-39). */
export function recommendationOwned(account: MockClinicAccountRecord, r: (typeof db.recommendations)[number]): boolean {
  if (!isDoctor(account)) return true
  const appointment = r.appointmentId ? db.appointments.find((a) => a.id === r.appointmentId) : undefined
  const exam = r.examinationId ? db.examinations.find((e) => e.id === r.examinationId) : undefined
  return (appointment !== undefined && ownsAppointment(account, appointment)) || (exam !== undefined && ownsExam(account, exam))
}

export function toClinicRecommendation(r: (typeof db.recommendations)[number]): ClinicRecommendation {
  return {
    id: r.id,
    appointmentId: r.appointmentId,
    examinationId: r.examinationId,
    patientName: memberName(r.memberId),
    text: r.text,
    createdAt: r.createdAt,
  }
}

/** `GET /clinic-portal/recommendations`: só as da própria clínica, mais recentes primeiro. */
export function listClinicRecommendations(clinicAccountId: string, origin?: Partial<RecommendationOrigin>) {
  return respond((): ClinicRecommendation[] => {
    const account = requireAccount(clinicAccountId)
    const { clinicId } = account
    const o = origin as { appointmentId?: string; examinationId?: string } | undefined
    return db.recommendations
      .filter(
        (r) =>
          r.clinicId === clinicId &&
          recommendationOwned(account, r) &&
          (!o?.appointmentId || r.appointmentId === o.appointmentId) &&
          (!o?.examinationId || r.examinationId === o.examinationId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toClinicRecommendation)
  })
}

// --- Marcação presencial (`/clinic-portal/patient-lookup` e `/walk-in-appointments`, ADR-024) ---

/** Primeiro nome + inicial do último apelido (“Maria S.”): o mínimo para o gestor confirmar a pessoa. */
export function displayNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  return last ? `${parts[0]} ${last[0]?.toUpperCase()}.` : (parts[0] ?? '')
}

/**
 * Resolve o utilizador pelo e-mail exato. Inexistente, suspenso ou sem membro próprio (o membro ligado à sua conta) dão a mesma
 * resposta (NOT_FOUND) para não revelar que contas existem (BR-CLN-10).
 */
function resolveWalkInPatient(email: string) {
  const address = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) throw new AppError('VALIDATION_ERROR')
  const user = db.users.find((u) => u.email.toLowerCase() === address && u.status === 'ACTIVE')
  const member = user && db.members.find((m) => m.userId === user.id && m.status === 'ACTIVE')
  if (!member) throw new AppError('NOT_FOUND')
  return member
}

/** `POST /clinic-portal/patient-lookup`: só o nome de apresentação, nunca ids. */
export function lookupClinicPatient(clinicAccountId: string, email: string) {
  return respond((): { displayName: string } => {
    requireStaffAccount(clinicAccountId)
    return { displayName: displayNameOf(resolveWalkInPatient(email).name) }
  })
}

/**
 * `POST /clinic-portal/walk-in-appointments` (BR-CLN-10/18): consulta SCHEDULED num horário livre
 * da própria clínica. Exatamente um de `patientEmail` e `clinicPatientId`. (a) e-mail: consulta no
 * membro SELF e paciente da clínica criado/reutilizado, com consentimento BOOKINGS; (b) paciente
 * ligado a um membro: consulta nesse membro; (c) sem ligação: visita manual só da clínica.
 */
export function createClinicWalkIn(clinicAccountId: string, input: ClinicWalkInInput, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const account = requireStaffAccount(clinicAccountId)
    const { clinicId } = account
    expireRequests(now)
    if (Boolean(input.patientEmail) === Boolean(input.clinicPatientId)) throw new AppError('VALIDATION_ERROR')
    const slot = db.slots.find((s) => s.id === input.slotId && s.clinicId === clinicId)
    if (!slot) throw new AppError('NOT_FOUND')

    let member: ReturnType<typeof resolveWalkInPatient> | undefined
    let clinicPatient: (typeof db.clinicPatients)[number] | undefined
    if (input.patientEmail) {
      member = resolveWalkInPatient(input.patientEmail)
    } else {
      clinicPatient = db.clinicPatients.find((p) => p.id === input.clinicPatientId && p.clinicId === clinicId)
      if (!clinicPatient) throw new AppError('NOT_FOUND')
      member = clinicPatient.memberId ? db.members.find((m) => m.id === clinicPatient!.memberId) : undefined
    }

    if (slot.kind !== 'APPOINTMENT') throw new AppError('VALIDATION_ERROR')
    if (appointmentSlotTaken(slot.id) || Date.parse(slot.startsAt) <= now.getTime()) throw new AppError('CONFLICT')
    const start = Date.parse(slot.startsAt)
    const end = start + slot.durationMinutes * 60_000

    if (!member) {
      // (c) Visita presencial só da clínica: sobreposição entre visitas SCHEDULED do mesmo paciente.
      const patient = clinicPatient!
      const overlaps = db.clinicVisits.some(
        (v) =>
          v.clinicPatientId === patient.id &&
          v.status === 'SCHEDULED' &&
          Date.parse(v.scheduledAt) < end &&
          Date.parse(v.scheduledAt) + v.durationMinutes * 60_000 > start,
      )
      if (overlaps) throw new AppError('CONFLICT')
      const visit = {
        id: newId('vis'),
        clinicId,
        clinicPatientId: patient.id,
        slotId: slot.id,
        scheduledAt: slot.startsAt,
        durationMinutes: slot.durationMinutes,
        specialty: slot.specialty,
        professionalId: slot.professionalId,
        professionalName: slot.professionalName,
        status: 'SCHEDULED' as const,
        notes: input.notes?.trim() || undefined,
      }
      db.clinicVisits.push(visit)
      recordClinicAudit(account, 'CLINIC_VISIT_BOOK', 'ClinicVisit', visit.id)
      return toVisitBooking(visit)
    }

    const overlaps = db.appointments.some(
      (a) =>
        a.memberId === member.id &&
        a.status === 'SCHEDULED' &&
        Date.parse(a.scheduledAt) < end &&
        Date.parse(a.scheduledAt) + 30 * 60_000 > start,
    )
    if (overlaps) throw new AppError('CONFLICT')
    if (input.patientEmail) linkMember(clinicId, member.id, displayNameOf(member.name), 'EMAIL', now)
    const clinic = db.clinics.find((c) => c.id === clinicId)
    const appointment: Appointment = {
      id: newId('apt'),
      familyId: member.familyId,
      memberId: member.id,
      status: 'SCHEDULED',
      scheduledAt: slot.startsAt,
      slotId: slot.id,
      specialty: slot.specialty,
      professionalName: slot.professionalName,
      clinicId,
      clinicName: clinic?.name,
      notes: input.notes?.trim() || undefined,
      scheduledSince: now.toISOString(),
    }
    db.appointments.push(appointment)
    recordClinicAudit(account, 'CLINIC_WALKIN_BOOK', 'Appointment', appointment.id)
    return toBooking(appointment)
  })
}
