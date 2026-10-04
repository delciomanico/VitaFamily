import type { Appointment } from '@/types/appointment'
import { raiseAlerts } from './alertRules'
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
      notifyResponse(appointment, appointment.scheduledAt)
    }
  }
}

const RESPONSE_ALERT = {
  SCHEDULED: { type: 'APPOINTMENT_CONFIRMED', ruleKey: 'appointment.confirmed' },
  REJECTED: { type: 'APPOINTMENT_REJECTED', ruleKey: 'appointment.rejected' },
  CANCELLED: { type: 'APPOINTMENT_CANCELLED', ruleKey: 'appointment.cancelled' },
} as const

/** Avisa a família da resposta da clínica ao pedido ou à consulta (FR-APT-07). */
export function notifyResponse(appointment: Appointment, at: string) {
  if (!(appointment.status in RESPONSE_ALERT)) return
  const rule = RESPONSE_ALERT[appointment.status as keyof typeof RESPONSE_ALERT]
  raiseAlerts(db, [
    {
      familyId: appointment.familyId,
      memberId: appointment.memberId,
      ...rule,
      sourceType: 'APPOINTMENT',
      sourceId: appointment.id,
      triggerAt: at,
      occurrence: appointment.scheduledAt,
    },
  ])
}
