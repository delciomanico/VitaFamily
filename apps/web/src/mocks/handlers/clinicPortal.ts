import { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import type { Clinic, ClinicBooking, ClinicSlot, ClinicSlotView } from '@/types/clinic'
import { memberName } from '../access'
import { bookingOf, expireRequests, notifyResponse } from '../bookings'
import { db, newId } from '../db'
import { respond } from '../respond'

/*
 * Portal da clínica parceira (D17). O Gestor só vê as marcações da própria clínica, com os dados
 * mínimos (BR-CLN-03): nunca família, membro, nem dados de saúde.
 * TODO(fase 10): avisar a família quando a clínica confirma, recusa ou cancela (FR-APT-07).
 */

export interface PublishSlotsInput {
  /** Dia local (yyyy-mm-dd). */
  date: string
  /** Horas locais HH:mm. */
  times: string[]
  specialty: string
  professionalName?: string
  durationMinutes: number
}

/** Durações aceites por horário. */
export const SLOT_DURATIONS = [15, 20, 30, 45, 60] as const

/** Clínica gerida pelo utilizador; sem papel de Gestor → FORBIDDEN. */
function requireClinic(userId: string): Clinic {
  const staff = db.clinicStaff.find((s) => s.userId === userId)
  const clinic = staff && db.clinics.find((c) => c.id === staff.clinicId && c.type === 'PARTNER')
  if (!clinic) throw new AppError('FORBIDDEN')
  return clinic
}

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
function findBooking(clinic: Clinic, id: string): Appointment {
  const appointment = db.appointments.find((a) => a.id === id && a.clinicId === clinic.id && a.slotId)
  if (!appointment) throw new AppError('NOT_FOUND')
  return appointment
}

/** Clínica do utilizador, se for Gestor de uma clínica parceira. */
export function getClinicMembership(userId: string) {
  return respond((): Clinic | null => {
    try {
      return requireClinic(userId)
    } catch {
      return null
    }
  })
}

/** Marcações feitas nos horários da clínica, por ordem cronológica (UC-CLN-05/06). */
export function listClinicBookings(userId: string, now: Date = new Date()) {
  return respond((): ClinicBooking[] => {
    const clinic = requireClinic(userId)
    expireRequests(now)
    return db.appointments
      .filter((a) => a.clinicId === clinic.id && a.slotId)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .map(toBooking)
  })
}

/** Confirmar um pedido: a consulta fica AGENDADA (UC-CLN-05). */
export function confirmBooking(userId: string, id: string, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const clinic = requireClinic(userId)
    expireRequests(now)
    const appointment = findBooking(clinic, id)
    if (appointment.status !== 'REQUESTED') throw new AppError('CONFLICT')
    appointment.status = 'SCHEDULED'
    notifyResponse(appointment, now.toISOString())
    return toBooking(appointment)
  })
}

/** Recusar um pedido, com motivo opcional; o horário volta a ficar livre (UC-CLN-05). */
export function rejectBooking(userId: string, id: string, note?: string, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const clinic = requireClinic(userId)
    expireRequests(now)
    const appointment = findBooking(clinic, id)
    if (appointment.status !== 'REQUESTED') throw new AppError('CONFLICT')
    appointment.status = 'REJECTED'
    appointment.responseNote = note?.trim() || undefined
    notifyResponse(appointment, now.toISOString())
    return toBooking(appointment)
  })
}

/** Cancelar uma consulta confirmada e futura, com motivo obrigatório (UC-CLN-06). */
export function cancelBooking(userId: string, id: string, note: string, now: Date = new Date()) {
  return respond((): ClinicBooking => {
    const clinic = requireClinic(userId)
    const appointment = findBooking(clinic, id)
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

/** Horários futuros da clínica, com o estado de cada um (UC-CLN-04). */
export function listClinicSlots(userId: string, now: Date = new Date()) {
  return respond((): ClinicSlotView[] => {
    const clinic = requireClinic(userId)
    expireRequests(now)
    return db.slots
      .filter((slot) => slot.clinicId === clinic.id && Date.parse(slot.startsAt) > now.getTime())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.specialty.localeCompare(b.specialty))
      .map((slot) => ({
        ...slot,
        state: bookingOf(slot.id)?.status === 'SCHEDULED' ? 'SCHEDULED' : bookingOf(slot.id) ? 'REQUESTED' : 'FREE',
      }))
  })
}

/** Publicar horários num dia (UC-CLN-04). Ignora horas passadas e repetidas (mesma hora e profissional). */
export function publishSlots(userId: string, input: PublishSlotsInput, now: Date = new Date()) {
  return respond((): ClinicSlot[] => {
    const clinic = requireClinic(userId)
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
          s.clinicId === clinic.id &&
          s.startsAt === iso &&
          s.professionalName === professionalName &&
          s.specialty === specialty,
      )
      if (startsAt.getTime() <= now.getTime() || duplicate) continue
      const slot = {
        id: newId('slot'),
        clinicId: clinic.id,
        specialty,
        professionalName,
        startsAt: iso,
        durationMinutes: input.durationMinutes,
      }
      db.slots.push(slot)
      created.push(slot)
    }
    return created
  })
}

/** Remover um horário livre (BR-CLN-04). */
export function removeSlot(userId: string, slotId: string) {
  return respond(() => {
    const clinic = requireClinic(userId)
    const slot = db.slots.find((s) => s.id === slotId && s.clinicId === clinic.id)
    if (!slot) throw new AppError('NOT_FOUND')
    if (bookingOf(slot.id)) throw new AppError('CONFLICT')
    db.slots = db.slots.filter((s) => s.id !== slotId)
  })
}
