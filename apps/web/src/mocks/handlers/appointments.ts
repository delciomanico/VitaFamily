import { AppError } from '@/lib/errors'
import type { Appointment, AppointmentItem } from '@/types/appointment'
import { findVisibleMember, memberName, visibleMemberIds } from '../access'
import { db, newId } from '../db'
import { respond } from '../respond'
import { visibleClinics } from './clinics'

export interface AppointmentInput {
  /** Instante ISO; tem de ser futuro numa consulta agendada. */
  scheduledAt: string
  /** TBD: especialidade (só UI e mocks). */
  specialty?: string
  /** Clínica parceira ou privada da família, ou nenhuma (BR-APT-04). */
  clinicId?: string
  professionalName?: string
  notes?: string
}

export interface NewAppointmentInput extends AppointmentInput {
  memberId: string
}

/*
 * Consultas (C5). Sem pedido nem confirmação pela clínica (BR-APT-04): a consulta nasce AGENDADA.
 * TODO(fase 10): gerar os lembretes 24 h e 2 h antes (BR-APT-03).
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
  if (input.clinicId && !clinic) throw new AppError('VALIDATION_ERROR')
  return {
    scheduledAt: new Date(input.scheduledAt).toISOString(),
    specialty: input.specialty?.trim() || undefined,
    clinicId: clinic?.id,
    clinicName: clinic?.name,
    professionalName: input.professionalName?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
  }
}

/** Lembretes ainda por disparar deixam de fazer sentido ao reagendar ou cancelar (BR-APT-03). */
function dropFutureAlerts(appointmentId: string, now: Date) {
  db.alerts = db.alerts.filter(
    (a) => a.sourceType !== 'APPOINTMENT' || a.sourceId !== appointmentId || Date.parse(a.triggerAt) <= now.getTime(),
  )
}

/** Consultas visíveis por ordem cronológica (UC-APT-05); a UI separa próximas e histórico. */
export function listAppointments(familyId: string, userId: string) {
  return respond((): AppointmentItem[] =>
    db.appointments
      .filter(inScope(familyId, userId))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .map(toItem),
  )
}

export function getAppointment(familyId: string, userId: string, id: string) {
  return respond(() => toItem(findAppointment(familyId, userId, id)))
}

/** Marcar consulta (UC-APT-01). */
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
    if (appointment.status !== 'SCHEDULED') throw new AppError('VALIDATION_ERROR')
    const rescheduled = new Date(input.scheduledAt).toISOString() !== appointment.scheduledAt
    Object.assign(appointment, fields(familyId, input, now))
    if (rescheduled) dropFutureAlerts(id, now)
    return appointment
  })
}

/**
 * Cancelar (UC-APT-03) uma consulta agendada, ou registar o desfecho (UC-APT-04) depois da hora:
 * REALIZADA ou FALTOU. Uma consulta passada sem desfecho fica AGENDADA (BR-APT-02).
 */
export function setAppointmentStatus(
  familyId: string,
  userId: string,
  id: string,
  status: 'CANCELLED' | 'COMPLETED' | 'NO_SHOW',
  now: Date = new Date(),
) {
  return respond((): Appointment => {
    const appointment = findAppointment(familyId, userId, id)
    if (appointment.status !== 'SCHEDULED') throw new AppError('VALIDATION_ERROR')
    const past = Date.parse(appointment.scheduledAt) <= now.getTime()
    if (status !== 'CANCELLED' && !past) throw new AppError('VALIDATION_ERROR')
    appointment.status = status
    dropFutureAlerts(id, now)
    return appointment
  })
}
