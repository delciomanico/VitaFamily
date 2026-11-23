import { isValidISODate, monthsBefore, todayISO } from './date'

/** Períodos do Resumo de saúde (BR-RPT-12): atalhos de 30 dias, 90 dias e 12 meses, ou datas à escolha (máx. 5 anos). */
export type SummaryShortcut = '30' | '90' | '12m' | 'custom'

export const SUMMARY_MAX_YEARS = 5

export interface SummaryRange {
  from: string
  to: string
}

const DAY_MS = 86_400_000

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Intervalo de um atalho, a terminar em `to` (hoje por defeito). */
export function shortcutRange(shortcut: Exclude<SummaryShortcut, 'custom'>, to: string = todayISO()): SummaryRange {
  if (shortcut === '12m') return { from: monthsBefore(to, 12), to }
  return { from: addDays(to, -(Number(shortcut) - 1)), to }
}

/** Mensagem simples se as datas não servem; `null` se servem. */
export function rangeProblem(range: SummaryRange): string | null {
  if (!isValidISODate(range.from) || !isValidISODate(range.to)) return 'Escolha as duas datas.'
  if (range.from > range.to) return 'A data de início tem de ser anterior à data de fim.'
  if (range.from < monthsBefore(range.to, SUMMARY_MAX_YEARS * 12)) return 'O período pode ter, no máximo, 5 anos.'
  return null
}
