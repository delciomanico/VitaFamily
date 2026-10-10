import { AppError } from '@/lib/errors'
import type { Appointment, AppointmentItem } from '@/types/appointment'
import type { AvailableSlot } from '@/types/clinic'
import { findVisibleMember, memberName, visibleMemberIds } from '../access'
import { db, newId } from '../db'
import { bookingOf, expireRequests } from '../bookings'
import { respond } from '../respond'
import { visibleClinics } from './clinics'

export interface AppointmentInput {
  /** Instante ISO; tem de ser futuro numa consulta agendada. */
  scheduledAt: string
  /** TBD: especialidade (só UI e mocks). */
  specialty?: string
  /** Clínica privada da família, ou nenhuma; as parceiras marcam-se por horário (BR-APT-04). */
  clinicId?: string
  professionalName?: string
  notes?: string
}

export interface NewAppointmentInput extends AppointmentInput {
  memberId: string
}

/** Pedido num horário publicado por uma clínica parceira (UC-APT-07). */
export interface AppointmentRequestInput {
  memberId: string
  slotId: string
  notes?: string
}

/*
 * Consultas (C5). Clínica parceira: pedido num horário publicado, que a clínica confirma ou recusa
 * (D17, BR-APT-04). Clínica privada ou sem clínica: registo direto, nasce AGENDADA.
 * TODO(fase 10): lembretes 24 h e 2 h antes das AGENDADAS (BR-APT-03/07) e aviso da resposta (FR-APT-07).
 */

function inScope(familyId: string, userId: string) {
  const visible = new Set(visibleMemberIds(familyId, userId))
  return (item: { familyId: string; memberId: string }) => item.familyId === familyId && visible.has(item.memberId)
}

function findAppointment(familyId: string, userId: string, id: string): Appointment {
  const appointment = db.appointments.find((a) => a.id === id)
  if (!appointment || !inScope(familyId, userId)(appointment)) throw new AppError('NOT_FOUND')
  return appointment
}

const toItem = (appointment: Appointment): AppointmentItem => ({
  appointment,
  memberName: memberName(appointment.memberId),
})

/** Valida o formulário e devolve os campos a gravar (a clínica guarda também o nome, BR-CLN-02). */
function fields(familyId: string, input: AppointmentInput, now: Date) {
  if (Number.isNaN(Date.parse(input.scheduledAt)) || Date.parse(input.scheduledAt) <= now.getTime()) {
    throw new AppError('VALIDATION_ERROR')
  }
  const clinic = input.clinicId ? visibleClinics(familyId).find((c) => c.id === input.clinicId) : undefined
  // Numa parceira só se marca por horário (BR-APT-04).
  if (input.clinicId && (!clinic || clinic.type === 'PARTNER')) throw new AppError('VALIDATION_ERROR')
  return {
    scheduledAt: new Date(input.scheduledAt).toISOString(),
    specialty: input.specialty?.trim() || undefined,
    clinicId: clinic?.id,
    clinicName: clinic?.name,
    professionalName: input.professionalName?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
  }
}

/** Consultas visíveis por ordem cronológica (UC-APT-05); a UI separa próximas e histórico. */
export function listAppointments(familyId: string, userId: string, now: Date = new Date()) {
  return respond((): AppointmentItem[] => {
    expireRequests(now)
    return db.appointments
      .filter(inScope(familyId, userId))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .map(toItem)
  })
}

export function getAppointment(familyId: string, userId: string, id: string, now: Date = new Date()) {
  return respond(() => {
    expireRequests(now)
    return toItem(findAppointment(familyId, userId, id))
  })
}

/** Horários livres e futuros das clínicas parceiras para uma especialidade, por ordem cronológica. */
export function listAvailableSlots(familyId: string, specialty: string, now: Date = new Date()) {
  return respond((): AvailableSlot[] => {
    expireRequests(now)
    const wanted = specialty.trim().toLocaleLowerCase('pt-PT')
    const partners = new Map(
      visibleClinics(familyId)
        .filter((c) => c.type === 'PARTNER')
        .map((c) => [c.id, c.name]),
    )
    return db.slots
      .filter(
        (slot) =>
          partners.has(slot.clinicId) &&
          slot.specialty.toLocaleLowerCase('pt-PT') === wanted &&
          Date.parse(slot.startsAt) > now.getTime() &&
          !bookingOf(slot.id),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((slot) => ({ ...slot, clinicName: partners.get(slot.clinicId) ?? '' }))
  })
}

/** Pedir consulta num horário livre (UC-APT-07): fica PEDIDA até a clínica responder. */
export function requestAppointment(
  familyId: string,
  userId: string,
  input: AppointmentRequestInput,
  now: Date = new Date(),
) {
  return respond((): Appointment => {
    findVisibleMember(familyId, userId, input.memberId)
    expireRequests(now)
    const slot = db.slots.find((s) => s.id === input.slotId)
    const clinic = slot && visibleClinics(familyId).find((c) => c.id === slot.clinicId && c.type === 'PARTNER')
    if (!slot || !clinic || Date.parse(slot.startsAt) <= now.getTime()) throw new AppError('NOT_FOUND')
    if (bookingOf(slot.id)) throw new AppError('CONFLICT')
    const appointment: Appointment = {
      id: newId('apt'),
      familyId,
      memberId: input.memberId,
      status: 'REQUESTED',
      scheduledAt: slot.startsAt,
      slotId: slot.id,
      specialty: slot.specialty,
      professionalName: slot.professionalName,
      clinicId: clinic.id,
      clinicName: clinic.name,
      notes: input.notes?.trim() || undefined,
    }
    db.appointments.push(appointment)
    return appointment
  })
}

/** Registar consulta diretamente (UC-APT-01): clínica privada ou sem clínica. */
export function createAppointment(
  familyId: string,
  userId: string,
  input: NewAppointmentInput,
  now: Date = new Date(),
) {
  return respond((): Appointment => {
    findVisibleMember(familyId, userId, input.memberId)
    const appointment: Appointment = {
      id: newId('apt'),
      familyId,
      memberId: input.memberId,
      status: 'SCHEDULED',
      ...fields(familyId, input, now),
    }
    db.appointments.push(appointment)
    return appointment
  })
}

/** Editar ou reagendar uma consulta agendada (UC-APT-02). */
export function updateAppointment(
  familyId: string,
  userId: string,
  id: string,
  input: AppointmentInput,
  now: Date = new Date(),
) {
  return respond((): Appointment => {
    const appointment = findAppointment(familyId, userId, id)
    // As de clínica parceira mudam-se cancelando e pedindo outro horário (BR-APT-09).
    if (appointment.status !== 'SCHEDULED' || appointment.slotId) throw new AppError('VALIDATION_ERROR')
    // Os lembretes seguem a nova data (a chave de cada alerta inclui a data da consulta).
    Object.assign(appointment, fields(familyId, input, now))
    return appointment
  })
}

/**
 * Cancelar (UC-APT-03) uma consulta agendada ou desistir de um pedido; ou registar o desfecho
 * (UC-APT-04) depois da hora: REALIZADA ou FALTOU. Passada sem desfecho fica AGENDADA (BR-APT-02).
 */
export function setAppointmentStatus(
  familyId: string,
  userId: string,
  id: string,
  status: 'CANCELLED' | 'COMPLETED' | 'NO_SHOW',
  now: Date = new Date(),
) {
  return respond((): Appointment => {
    expireRequests(now)
    const appointment = findAppointment(familyId, userId, id)
    const cancellable = appointment.status === 'SCHEDULED' || appointment.status === 'REQUESTED'
    if (status === 'CANCELLED' ? !cancellable : appointment.status !== 'SCHEDULED')
      throw new AppError('VALIDATION_ERROR')
    const past = Date.parse(appointment.scheduledAt) <= now.getTime()
    if (status !== 'CANCELLED' && !past) throw new AppError('VALIDATION_ERROR')
    appointment.status = status
    return appointment
  })
}
