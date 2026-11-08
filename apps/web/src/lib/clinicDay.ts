import type { Tone } from '@/components/ui/Badge'
import type { ClinicDayState, ConfirmationStatus, ClinicFollowUpInput } from '@/types/clinic'
import { todayISO } from './date'

/*
 * Fila do dia e confirmação da clínica (M14 Q, BR-CLN-25/28). Regras puras, partilhadas pela UI
 * e pelo backend simulado; o estado "do dia" é derivado, nunca um novo estado Vita.
 */

/** Estado do dia derivado do estado Vita + `arrivedAt`/`startedAt` (BR-CLN-28). */
export function deriveDayState(
  status: ClinicDayState,
  arrivedAt?: string | null,
  startedAt?: string | null,
): ClinicDayState {
  if (status !== 'SCHEDULED') return status
  if (startedAt) return 'IN_PROGRESS'
  if (arrivedAt) return 'ARRIVED'
  return 'SCHEDULED'
}

/** Espera em minutos inteiros (≥ 0): (startedAt ou agora) − arrivedAt; nulo sem `arrivedAt`. */
export function waitingMinutesOf(
  arrivedAt: string | null | undefined,
  startedAt: string | null | undefined,
  now: Date,
): number | null {
  if (!arrivedAt) return null
  const end = startedAt ? Date.parse(startedAt) : now.getTime()
  return Math.max(0, Math.floor((end - Date.parse(arrivedAt)) / 60_000))
}

/** Mesmo dia local (yyyy-mm-dd) que `now`. */
export function isSameLocalDay(iso: string, now: Date): boolean {
  return todayISO(new Date(iso)) === todayISO(now)
}

export const dayStateLabel: Record<ClinicDayState, { label: string; tone: Tone }> = {
  SCHEDULED: { label: 'Agendada', tone: 'primary' },
  ARRIVED: { label: 'Chegou', tone: 'warning' },
  IN_PROGRESS: { label: 'Em consulta', tone: 'primary' },
  COMPLETED: { label: 'Concluída', tone: 'success' },
  NO_SHOW: { label: 'Faltou', tone: 'danger' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  REQUESTED: { label: 'Aguarda confirmação', tone: 'warning' },
  REJECTED: { label: 'Recusada', tone: 'danger' },
}

/** Estado de confirmação (BR-CLN-25). `CONFIRMED` por telefone distingue-se da resposta na app. */
export function confirmationLabel(
  status: ConfirmationStatus | null | undefined,
  source?: 'PATIENT' | 'CLINIC' | null,
): { label: string; tone: Tone } {
  switch (status) {
    case 'CONFIRMED':
      return { label: source === 'CLINIC' ? 'Confirmada por telefone' : 'Confirmada', tone: 'success' }
    case 'DECLINED':
      return { label: 'Recusou', tone: 'danger' }
    default:
      return { label: 'Sem resposta', tone: 'neutral' }
  }
}

/** Atalhos de "Voltar em…" (um toque). */
export const FOLLOW_UP_PRESETS: Array<ClinicFollowUpInput & { label: string }> = [
  { amount: 2, unit: 'WEEKS', label: '2 semanas' },
  { amount: 1, unit: 'MONTHS', label: '1 mês' },
  { amount: 3, unit: 'MONTHS', label: '3 meses' },
  { amount: 6, unit: 'MONTHS', label: '6 meses' },
]

export function followUpLabel({ amount, unit }: ClinicFollowUpInput): string {
  const noun = unit === 'WEEKS' ? (amount === 1 ? 'semana' : 'semanas') : amount === 1 ? 'mês' : 'meses'
  return `${amount} ${noun}`
}

/** Dia local (yyyy-mm-dd) + N semanas ou N meses (BR-CLN-30). */
export function addFollowUp(day: string, { amount, unit }: ClinicFollowUpInput): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const result = new Date(year, month - 1, date)
  if (unit === 'WEEKS') result.setDate(result.getDate() + amount * 7)
  else result.setMonth(result.getMonth() + amount)
  return todayISO(result)
}
