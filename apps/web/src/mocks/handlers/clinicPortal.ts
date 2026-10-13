import { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import type {
  ClinicAccount,
  ClinicBooking,
  ClinicCompleteInput,
  ClinicRequestDecision,
  ClinicSession,
  ClinicSlot,
  ClinicSlotView,
  PublishSlotsInput,
} from '@/types/clinic'
import { SLOT_DURATIONS } from '@/types/clinic'
import { memberName } from '../access'
import { bookingOf, expireRequests, notifyResponse } from '../bookings'
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
function requireAccount(clinicAccountId: string): MockClinicAccountRecord {
  const account = db.clinicAccounts.find((a) => a.id === clinicAccountId)
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  if (account.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED')
  return account
}

/** Só o Admin da clínica gere os Gestores da própria clínica (BR-CLN-05). */
function requireAdmin(clinicAccountId: string): MockClinicAccountRecord {
  const account = requireAccount(clinicAccountId)
  if (account.role !== 'CLINIC_ADMIN') throw new AppError('FORBIDDEN')
  return account
}

function clinicNameOf(clinicId: string): string | undefined {
  return db.clinics.find((c) => c.id === clinicId && c.type === 'PARTNER')?.name
}

function toSession(account: MockClinicAccountRecord): ClinicSession {
  return {
    clinicId: account.clinicId,
    role: account.role,
    email: account.email,
    clinicName: clinicNameOf(account.clinicId),
  }
}

function toPublicAccount({ id, clinicId, email, role, status }: MockClinicAccountRecord): ClinicAccount {
  return { id, clinicId, email, role, status }
}

/** `ClinicBooking`: mínimo necessário (BR-CLN-03). */
function toBooking(appointment: Appointment): ClinicBooking {
  return {
    id: appointment.id,
    status: appointment.status,
    scheduledAt: appointment.scheduledAt,
    specialty: appointment.specialty,
    professionalName: appointment.professionalName,
    patientName: memberName(appointment.memberId),
    notes: appointment.notes,
    responseNote: appointment.responseNote,
  }
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

// --- Hierarquia de staff (`/clinic-portal/staff`, BR-CLN-05) ---

/** `GET /clinic-portal/staff`: Gestores da própria clínica (nunca os de outra). */
export function listClinicStaff(clinicAccountId: string) {
  return respond((): ClinicAccount[] => {
    const admin = requireAdmin(clinicAccountId)
    return db.clinicAccounts
      .filter((a) => a.clinicId === admin.clinicId && a.role === 'CLINIC_MANAGER')
      .map(toPublicAccount)
      .sort((a, b) => a.email.localeCompare(b.email, 'pt-PT'))
  })
}

/**
 * `POST /clinic-portal/staff`: cria sempre um `CLINIC_MANAGER` (BR-CLN-05). Na API real a
 * palavra-passe inicial vai por e-mail; no modo demo é a palavra-passe de demonstração.
 */
export function createClinicStaff(clinicAccountId: string, email: string) {
  return respond((): ClinicAccount => {
    const admin = requireAdmin(clinicAccountId)
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AppError('VALIDATION_ERROR')
    if (db.clinicAccounts.some((a) => a.email === address)) throw new AppError('VALIDATION_ERROR')
    const account: MockClinicAccountRecord = {
      id: newId('cac'),
      clinicId: admin.clinicId,
      email: address,
      password: DEMO_PASSWORD,
      role: 'CLINIC_MANAGER',
      status: 'ACTIVE',
    }
    db.clinicAccounts.push(account)
    return toPublicAccount(account)
  })
}

/** `DELETE /clinic-portal/staff/{clinicAccountId}`: só remove Gestores da própria clínica. */
export function removeClinicStaff(clinicAccountId: string, targetId: string) {
  return respond(() => {
    const admin = requireAdmin(clinicAccountId)
    const target = db.clinicAccounts.find(
      (a) => a.id === targetId && a.clinicId === admin.clinicId && a.role === 'CLINIC_MANAGER',
    )
    if (!target) throw new AppError('NOT_FOUND')
    db.clinicAccounts = db.clinicAccounts.filter((a) => a.id !== targetId)
  })
}

// --- Horários (`/clinic-portal/slots`, BR-CLN-04) ---

/** `GET /clinic-portal/slots`: horários futuros da clínica, com o estado de cada um (UC-CLN-04). */
export function listOwnClinicSlots(clinicAccountId: string, now: Date = new Date()) {
  return respond((): ClinicSlotView[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    return db.slots
      .filter((slot) => slot.clinicId === clinicId && Date.parse(slot.startsAt) > now.getTime())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.specialty.localeCompare(b.specialty))
      .map((slot) => ({
        ...slot,
        state: bookingOf(slot.id)?.status === 'SCHEDULED' ? 'SCHEDULED' : bookingOf(slot.id) ? 'REQUESTED' : 'FREE',
      }))
  })
}

/** `POST /clinic-portal/slots`: publicar horários num dia; ignora horas passadas e duplicadas. */
export function publishClinicSlots(clinicAccountId: string, input: PublishSlotsInput, now: Date = new Date()) {
  return respond((): ClinicSlot[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    const specialty = input.specialty.trim()
    const professionalName = input.professionalName?.trim() || undefined
    if (!specialty || input.times.length === 0) throw new AppError('VALIDATION_ERROR')
    if (!(SLOT_DURATIONS as readonly number[]).includes(input.durationMinutes)) throw new AppError('VALIDATION_ERROR')

    const created: ClinicSlot[] = []
    for (const time of input.times) {
      const startsAt = new Date(`${input.date}T${time}`)
      if (Number.isNaN(startsAt.getTime())) throw new AppError('VALIDATION_ERROR')
      const iso = startsAt.toISOString()
      const duplicate = db.slots.some(
        (s) =>
          s.clinicId === clinicId &&
          s.startsAt === iso &&
          s.professionalName === professionalName &&
          s.specialty === specialty,
      )
      if (startsAt.getTime() <= now.getTime() || duplicate) continue
      const slot = { id: newId('slot'), clinicId, specialty, professionalName, startsAt: iso, durationMinutes: input.durationMinutes }
      db.slots.push(slot)
      created.push(slot)
    }
    return created
  })
}

/** `DELETE /clinic-portal/slots/{slotId}`: só horários livres (BR-CLN-04). */
export function removeClinicSlot(clinicAccountId: string, slotId: string) {
  return respond(() => {
    const { clinicId } = requireAccount(clinicAccountId)
    const slot = db.slots.find((s) => s.id === slotId && s.clinicId === clinicId)
    if (!slot) throw new AppError('NOT_FOUND')
    if (bookingOf(slot.id)) throw new AppError('CONFLICT')
    db.slots = db.slots.filter((s) => s.id !== slotId)
  })
}

// --- Pedidos (`/clinic-portal/requests`, UC-CLN-05) ---

/** `GET /clinic-portal/requests`: só os pedidos por responder (`REQUESTED`). */
export function listClinicRequests(clinicAccountId: string, now: Date = new Date()) {
  return respond((): ClinicBooking[] => {
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    return db.appointments
      .filter((a) => a.clinicId === clinicId && a.status === 'REQUESTED')
      .map(toBooking)
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
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    const appointment = findBooking(clinicId, appointmentId)
    if (appointment.status !== 'REQUESTED') throw new AppError('CONFLICT')
    appointment.status = decision === 'CONFIRM' ? 'SCHEDULED' : 'REJECTED'
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
    const { clinicId } = requireAccount(clinicAccountId)
    expireRequests(now)
    return db.appointments
      .filter((a) => a.clinicId === clinicId && AGENDA_STATUSES.includes(a.status))
      .map(toBooking)
      .sort(byScheduledAt)
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
    const { clinicId } = requireAccount(clinicAccountId)
    const appointment = findBooking(clinicId, appointmentId)
    if (!note.trim()) throw new AppError('VALIDATION_ERROR')
    if (appointment.status !== 'SCHEDULED' || Date.parse(appointment.scheduledAt) <= now.getTime()) {
      throw new AppError('CONFLICT')
    }
    appointment.status = 'CANCELLED'
    appointment.responseNote = note.trim()
    notifyResponse(appointment, now.toISOString())
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
    const { clinicId } = requireAccount(clinicAccountId)
    const appointment = findBooking(clinicId, appointmentId)
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
    return toBooking(appointment)
  })
}
