import type { Appointment } from '@/types/appointment'
import { todayISO } from './date'
import { appointmentStatus, type StatusLabel } from './labels'

/** Agendada ou pedida à clínica (D17), e ainda por acontecer. */
export function isUpcoming(appointment: Appointment, now: Date = new Date()): boolean {
  const active = appointment.status === 'SCHEDULED' || appointment.status === 'REQUESTED'
  return active && Date.parse(appointment.scheduledAt) > now.getTime()
}

/** Já passou e continua agendada: falta registar se foi realizada ou se faltou (BR-APT-02). */
export function needsOutcome(appointment: Appointment, now: Date = new Date()): boolean {
  return appointment.status === 'SCHEDULED' && Date.parse(appointment.scheduledAt) <= now.getTime()
}

/** Estado a mostrar; uma consulta passada sem desfecho não é dada como realizada. */
export function appointmentStatusLabel(appointment: Appointment, now: Date = new Date()): StatusLabel {
  return needsOutcome(appointment, now)
    ? { label: 'Por atualizar', tone: 'warning' }
    : appointmentStatus[appointment.status]
}

/** Dia local (yyyy-mm-dd) de um instante ISO. */
export function localDay(iso: string): string {
  return todayISO(new Date(iso))
}

/** Instante ISO a partir de dia (yyyy-mm-dd) e hora (HH:mm) locais. */
export function combineDateTime(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString()
}

/** Horários sugeridos para marcar: das 08:00 às 19:30, de meia em meia hora. */
export const APPOINTMENT_TIMES = Array.from({ length: 24 }, (_, i) => {
  const minutes = 8 * 60 + i * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`
})
