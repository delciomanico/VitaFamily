import { isValidISODate, todayISO } from '@/lib/date'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate } from '@/lib/format'
import type { ProfessionalScheduleGeneration, ProfessionalScheduleRule, Weekday } from '@/types/professional'

/** Todas as horas do mercado são de Luanda (Africa/Luanda, UTC+1, sem horário de verão). */
export const MAX_NOTE_LENGTH = 200
export const MAX_RANGE_DAYS = 62
export const DEFAULT_RANGE_DAYS = 14
const DAY_MS = 86_400_000

/** Instante ISO de uma data e hora locais de Luanda. */
export const luandaIso = (date: string, time: string) => `${date}T${time}:00+01:00`

/** Minutos desde a meia-noite de um HH:mm. */
export function minutesOf(hhmm: string): number {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

/** Soma dias a uma data ISO (yyyy-mm-dd) sem depender do fuso. */
export function addDays(iso: string, days: number): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number)
  return todayISO(new Date(year, month - 1, day + days))
}

function daysBetween(from: string, to: string): number {
  const [fy = 0, fm = 1, fd = 1] = from.split('-').map(Number)
  const [ty = 0, tm = 1, td = 1] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}

/** Validação do intervalo de horários gerados (máx. 62 dias, como a API). */
export function validateRange(from: string, to: string): string | null {
  if (!isValidISODate(from) || !isValidISODate(to)) return 'Indique as duas datas do intervalo.'
  if (to < from) return 'A data «até» tem de ser igual ou posterior à data «de».'
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return `O intervalo pode ter no máximo ${MAX_RANGE_DAYS} dias.`
  return null
}

export const sortedDays = (days: Weekday[]) => [...days].sort((a, b) => a - b)

export function validityText(rule: ProfessionalScheduleRule): string {
  if (!rule.validFrom && !rule.validUntil) return 'Sem data de fim'
  const parts: string[] = []
  if (rule.validFrom) parts.push(`de ${formatShortDate(rule.validFrom)}`)
  if (rule.validUntil) parts.push(`até ${formatShortDate(rule.validUntil)}`)
  return `Vale ${parts.join(' ')}`
}

/** Mensagem de sobreposição (CONFLICT) específica; o resto vem de `errorMessage`. */
export function ruleErrorMessage(error: unknown): string {
  if (isAppError(error, 'CONFLICT')) return 'Este horário sobrepõe-se a outro que já tem ativo. Mude as horas ou desative o outro.'
  return errorMessage(error)
}

export function timeOffErrorMessage(error: unknown): string {
  if (isAppError(error, 'CONFLICT')) return 'Este período sobrepõe-se a outra pausa.'
  return errorMessage(error)
}

/** Resumo da geração: sem perfil aprovado, as regras ficam guardadas e os horários só nascem depois. */
export function generationMessage(generation: ProfessionalScheduleGeneration, approved: boolean): string {
  if (!approved) return 'Horário guardado. Os horários livres aparecem quando o perfil for aprovado.'
  const skipped = generation.skippedOverlap + generation.skippedTimeOff
  const created = generation.created === 1 ? 'Criado 1 horário livre' : `Criados ${generation.created} horários livres`
  return skipped > 0 ? `${created}; ${skipped} ignorados por sobreposição ou pausa.` : `${created}.`
}
