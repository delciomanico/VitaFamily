import type { ExamResult, Examination } from '@/types/examination'
import { todayISO } from './date'

/*
 * Apresentação de exames e resultados. O sistema nunca interpreta valores (BR-EXM-02, D11):
 * a referência é mostrada tal como o utilizador a indicou, sem “dentro/fora”.
 */

/** TBD: quantos dias um exame realizado fica em “Recentes”. */
export const RECENT_EXAM_DAYS = 90

/** Agendados e realizados nos últimos 90 dias; os restantes (e os cancelados) ficam no histórico. */
export function isRecentExam(exam: Examination, now: Date = new Date()): boolean {
  if (exam.status === 'CANCELLED') return false
  if (exam.status === 'SCHEDULED') return true
  const since = new Date(now)
  since.setDate(since.getDate() - RECENT_EXAM_DAYS)
  return exam.examDate >= todayISO(since)
}

const numberFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 })

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

/** “13,2 g/dL”, ou o texto livre do resultado. */
export function formatResultValue(result: ExamResult): string {
  const value = result.valueNumeric !== undefined ? formatNumber(result.valueNumeric) : (result.valueText ?? '')
  return result.unit && result.valueNumeric !== undefined ? `${value} ${result.unit}` : value
}

/** “Referência: 70–99 mg/dL”, “Referência: até 5,7 %”, ou null sem referência. */
export function formatReference(result: Pick<ExamResult, 'referenceMin' | 'referenceMax' | 'unit'>): string | null {
  const { referenceMin: min, referenceMax: max, unit } = result
  const suffix = unit ? ` ${unit}` : ''
  if (min !== undefined && max !== undefined) return `Referência: ${formatNumber(min)}–${formatNumber(max)}${suffix}`
  if (max !== undefined) return `Referência: até ${formatNumber(max)}${suffix}`
  if (min !== undefined) return `Referência: a partir de ${formatNumber(min)}${suffix}`
  return null
}

/** Número em pt-PT (“13,2” ou “13.2”), ou null se o texto não for um número. */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  return Number(normalized)
}

/** Chave para juntar o mesmo parâmetro em exames diferentes (“Glicemia” = “glicemia ”). */
export function parameterKey(parameter: string): string {
  return parameter.trim().toLocaleLowerCase('pt-PT')
}
