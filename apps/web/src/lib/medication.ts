import type { MedicationPlan } from '@/types/medication'
import { localTime, todayISO } from './date'

/*
 * Regras de horário de um plano de toma (BR-MED-01/02), partilhadas pela UI e pelo backend simulado.
 * TODO(BR-ACC-04): usar o fuso do utilizador; o MVP usa o fuso do dispositivo.
 */

/** Intervalos permitidos em “de X em X horas”: todos dividem 24, por isso os horários repetem-se a cada dia. */
export const INTERVAL_HOURS = [4, 6, 8, 12, 24] as const

const DAY_MS = 86_400_000

/** “08:00” a partir de minutos desde a meia-noite. */
function toTime(minutes: number): string {
  const hours = String(Math.floor(minutes / 60) % 24).padStart(2, '0')
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`
}

function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** Horários de “de X em X horas” num dia, a partir da hora da primeira toma. */
export function intervalTimes(firstTime: string, intervalHours: number): string[] {
  const first = toMinutes(firstTime)
  const count = Math.max(1, Math.floor(24 / intervalHours))
  return Array.from({ length: count }, (_, i) => toTime((first + i * intervalHours * 60) % (24 * 60))).sort()
}

/** Horários diários do plano, ordenados. */
export function dailyTimes(
  plan: Pick<MedicationPlan, 'scheduleType' | 'times' | 'intervalHours' | 'startAt'>,
): string[] {
  if (plan.scheduleType === 'INTERVAL') return intervalTimes(localTime(plan.startAt), plan.intervalHours ?? 24)
  return [...(plan.times ?? [])].sort()
}

/** Dia da semana ISO (1 = segunda … 7 = domingo). */
function isoWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay()
}

/** Instante ISO de `time` (HH:mm local) no dia `date`. */
function atTime(date: Date, time: string): Date {
  const result = new Date(date)
  const minutes = toMinutes(time)
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return result
}

/** Tomas do plano num dia (instantes ISO), respeitando dias da semana, início e fim. */
export function dosesOnDay(plan: MedicationPlan, day: Date): string[] {
  if (plan.daysOfWeek?.length && !plan.daysOfWeek.includes(isoWeekday(day))) return []
  const start = Date.parse(plan.startAt)
  const end = plan.endAt ? Date.parse(plan.endAt) : Infinity
  return dailyTimes(plan)
    .map((time) => atTime(day, time).getTime())
    .filter((time) => time >= start && time <= end)
    .map((time) => new Date(time).toISOString())
}

/** Próxima toma depois de `now` (só planos ativos), ou null. */
export function nextDoseAt(plan: MedicationPlan, now: Date = new Date()): string | null {
  if (plan.status !== 'ACTIVE') return null
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now.getTime() + offset * DAY_MS)
    const next = dosesOnDay(plan, day).find((iso) => Date.parse(iso) > now.getTime())
    if (next) return next
  }
  return null
}

/** “1 vez por dia”, “3 vezes por dia”, “De 8 em 8 horas”; `short`: “3× por dia”, “8/8 h”. */
export function describeFrequency(plan: MedicationPlan, { short = false } = {}): string {
  if (plan.scheduleType === 'INTERVAL') {
    return short
      ? `${plan.intervalHours}/${plan.intervalHours} h`
      : `De ${plan.intervalHours} em ${plan.intervalHours} horas`
  }
  const count = plan.times?.length ?? 0
  if (short) return `${count}× por dia`
  return count === 1 ? '1 vez por dia' : `${count} vezes por dia`
}

/** Dias de calendário entre o início e o fim, inclusive. */
export function durationDays(plan: Pick<MedicationPlan, 'startAt' | 'endAt'>): number | null {
  if (!plan.endAt) return null
  const start = Date.parse(todayISO(new Date(plan.startAt)))
  const end = Date.parse(todayISO(new Date(plan.endAt)))
  return Math.round((end - start) / DAY_MS) + 1
}

/** “Uso contínuo” ou “7 dias”. */
export function describeDuration(plan: MedicationPlan): string {
  const days = durationDays(plan)
  if (plan.continuous || days === null) return 'Uso contínuo'
  return days === 1 ? '1 dia' : `${days} dias`
}
