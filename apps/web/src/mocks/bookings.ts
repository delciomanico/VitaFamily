import type { Appointment } from '@/types/appointment'
import { db } from './db'

/*
 * Regras partilhadas pela família e pelo portal da clínica (D17).
 */

/** Estados em que uma consulta ocupa o horário (BR-APT-06). */
const HOLDS_SLOT: Appointment['status'][] = ['REQUESTED', 'SCHEDULED']

/** Consulta ativa (pedida ou agendada) num horário, se existir. */
export function bookingOf(slotId: string): Appointment | undefined {
  return db.appointments.find((a) => a.slotId === slotId && HOLDS_SLOT.includes(a.status))
}

export const NO_RESPONSE_NOTE = 'Sem resposta da clínica até à hora marcada.'

/**
 * Processo do sistema (BR-APT-08): pedidos sem resposta até à hora passam a CANCELADA.
 * O backend fá-lo num job; os mocks aplicam-no sempre que as consultas são lidas.
 */
export function expireRequests(now: Date) {
  for (const appointment of db.appointments) {
    if (appointment.status === 'REQUESTED' && Date.parse(appointment.scheduledAt) <= now.getTime()) {
      appointment.status = 'CANCELLED'
      appointment.responseNote = NO_RESPONSE_NOTE
    }
  }
}

/** Lembretes ainda por disparar deixam de fazer sentido ao reagendar ou cancelar (BR-APT-03). */
export function dropFutureAlerts(appointmentId: string, now: Date) {
  db.alerts = db.alerts.filter(
    (a) => a.sourceType !== 'APPOINTMENT' || a.sourceId !== appointmentId || Date.parse(a.triggerAt) <= now.getTime(),
  )
}
