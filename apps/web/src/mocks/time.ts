import { todayISO } from '@/lib/date'

/*
 * Datas da demo relativas ao momento em que os dados são criados,
 * para que a demonstração pareça sempre atual (próxima consulta amanhã, tomas de hoje…).
 */

/** Instante ISO a `days` dias de hoje, à hora local `time` (HH:mm). */
export function at(days: number, time: string, now: Date = new Date()): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

/** Data ISO (yyyy-mm-dd) a `days` dias de hoje. */
export function day(days: number, now: Date = new Date()): string {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  return todayISO(date)
}

/** Instante ISO a `hours` horas de agora (negativo = passado). */
export function hoursFromNow(hours: number, now: Date = new Date()): string {
  return new Date(now.getTime() + hours * 3_600_000).toISOString()
}
