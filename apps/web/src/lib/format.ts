import { todayISO } from './date'

const LOCALE = 'pt-PT'

/*
 * Datas e horas em pt-PT.
 * TODO(BR-ACC-04): mostrar no fuso do utilizador (User.timezone); o MVP usa o fuso do dispositivo.
 */

/** “1 ano”, “39 anos”. */
export function formatAge(years: number): string {
  return years === 1 ? '1 ano' : `${years} anos`
}

/** “1 membro”, “4 membros”. */
export function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** Aceita instantes ISO e datas ISO (yyyy-mm-dd, interpretadas como data local). */
function toDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  return new Date(value)
}

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' })
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'short' })
const longDateFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' })

/** “09:30”. */
export function formatTime(value: string): string {
  return timeFormat.format(toDate(value))
}

/** Mês abreviado sem ponto: “out”. */
function shortMonth(date: Date): string {
  return monthFormat.format(date).replace('.', '')
}

/** “15 out”. */
export function formatDayMonth(value: string): string {
  const date = toDate(value)
  return `${date.getDate()} ${shortMonth(date)}`
}

/** “15 out 2026”. */
export function formatShortDate(value: string): string {
  return `${formatDayMonth(value)} ${toDate(value).getFullYear()}`
}

/** “15 de outubro de 2026”. */
export function formatLongDate(value: string): string {
  return longDateFormat.format(toDate(value))
}

/** Partes para o bloco de data dos cartões: { day: '15', month: 'OUT' }. */
export function dateBlock(value: string): { day: string; month: string } {
  const date = toDate(value)
  return { day: String(date.getDate()), month: shortMonth(date).toUpperCase() }
}

/** “Hoje”, “Amanhã”, “Ontem” ou “15 out”. */
export function formatRelativeDay(value: string, now: Date = new Date()): string {
  const target = todayISO(toDate(value))
  const offset = (days: number) => {
    const date = new Date(now)
    date.setDate(date.getDate() + days)
    return todayISO(date)
  }
  if (target === offset(0)) return 'Hoje'
  if (target === offset(1)) return 'Amanhã'
  if (target === offset(-1)) return 'Ontem'
  return formatDayMonth(value)
}

/** “Amanhã · 09:30”. */
export function formatWhen(value: string, now: Date = new Date()): string {
  return `${formatRelativeDay(value, now)} · ${formatTime(value)}`
}

/*
 * Fuso fixo Africa/Luanda (UTC+1, sem DST) para o mercado de profissionais (MK1): horários e carimbos
 * mostram-se na hora de Luanda, independentemente do fuso do dispositivo.
 */
export const LUANDA_TZ = 'Africa/Luanda'
const luandaTimeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: LUANDA_TZ })
const luandaDayFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: LUANDA_TZ })

/** Data ISO (yyyy-mm-dd) de um instante em Luanda. */
export function luandaDayISO(value: string | Date): string {
  return luandaDayFormat.format(typeof value === 'string' ? new Date(value) : value)
}

/** “09:30” em Luanda. */
export function formatTimeLuanda(value: string): string {
  return luandaTimeFormat.format(new Date(value))
}

/** “15 out 2026” com o dia em Luanda. */
export function formatShortDateLuanda(value: string): string {
  return formatShortDate(luandaDayISO(value))
}

/** “Amanhã · 09:30” em Luanda. */
export function formatWhenLuanda(value: string, now: Date = new Date()): string {
  const day = luandaDayISO(value)
  const today = luandaDayISO(now)
  const shifted = (days: number) => luandaDayISO(new Date(now.getTime() + days * 86_400_000))
  const label = day === today ? 'Hoje' : day === shifted(1) ? 'Amanhã' : day === shifted(-1) ? 'Ontem' : formatDayMonth(day)
  return `${label} · ${formatTimeLuanda(value)}`
}
