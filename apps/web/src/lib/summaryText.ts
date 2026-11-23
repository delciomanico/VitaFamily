import { formatCount } from './format'
import { alertCategoryLabels, alertCategoryOf } from './labels'
import { paths } from '@/routes/paths'
import type { AlertType } from '@/types/alert'
import type { MissingRecordItem } from '@/types/healthSummary'

/*
 * Texto do Resumo de saúde em linguagem simples. Nunca mostra códigos técnicos, nunca interpreta
 * valores (BR-EXM-02) e nunca sugere consultas ou exames (BR-RPT-17).
 */

const numberFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 })
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Número com vírgula decimal: 5,4. */
export const formatNumber = (value: number): string => numberFormat.format(value)

/** «+20 %», «−8 %» (só o sinal aritmético, sem juízo); `null` quando não se calcula. */
export function formatVariation(value: number | null | undefined, suffix = ''): string | null {
  if (value === null || value === undefined) return null
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(value))}${suffix}`
}

/** «out 2026» a partir de «2026-10». */
export function formatMonth(month: string): string {
  const [year = 0, m = 1] = month.split('-').map(Number)
  return `${MONTHS[m - 1] ?? ''} ${year}`
}

const countLabels: Record<string, [string, string]> = {
  COMPLETED: ['realizada', 'realizadas'],
  SCHEDULED: ['marcada', 'marcadas'],
  REQUESTED: ['pedida', 'pedidas'],
  CANCELLED: ['cancelada', 'canceladas'],
  REJECTED: ['recusada', 'recusadas'],
  NO_SHOW: ['em que faltou', 'em que faltou'],
}

/** «3 realizadas» a partir do estado e da contagem; estado desconhecido → «outras». */
export function statusCount(status: string, count: number): string {
  const [one, many] = countLabels[status] ?? ['outra', 'outras']
  return `${count} ${count === 1 ? one : many}`
}

/** Alertas agrupados por área (Medicamentos, Consultas…), sem texto de alertas. */
export function alertGroups(byType: Record<string, number>): Array<{ label: string; count: number }> {
  const groups = new Map<string, number>()
  for (const [type, count] of Object.entries(byType)) {
    const label = alertCategoryLabels[alertCategoryOf[type as AlertType] ?? 'OTHER']
    groups.set(label, (groups.get(label) ?? 0) + count)
  }
  return [...groups.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

export interface MissingRow {
  text: string
  /** Para onde levar quem pode escrever; sem ligação para quem só lê. */
  to?: string
}

/** Uma linha de «O que falta registar»: só completude do que já existe. */
export function missingRow(item: MissingRecordItem): MissingRow {
  const { code, count, sourceIds } = item
  const one = sourceIds && sourceIds.length === 1 ? sourceIds[0] : undefined
  const writable = sourceIds !== undefined
  switch (code) {
    case 'BLOOD_TYPE_UNSET':
      return { text: 'Tipo sanguíneo por indicar', to: writable || item.count === 1 ? paths.healthProfile : undefined }
    case 'APPOINTMENT_PAST_OPEN':
      return { text: `${formatCount(count, 'consulta passada por fechar', 'consultas passadas por fechar')}`, to: writable ? (one ? paths.appointment(one) : paths.appointments) : undefined }
    case 'EXAM_PAST_OPEN':
      return { text: `${formatCount(count, 'exame passado por fechar', 'exames passados por fechar')}`, to: writable ? (one ? paths.examination(one) : paths.examinations) : undefined }
    case 'EXAM_WITHOUT_RESULTS':
      return { text: `${formatCount(count, 'exame realizado sem resultados', 'exames realizados sem resultados')}`, to: writable ? (one ? paths.examination(one) : paths.examinations) : undefined }
    case 'PRESCRIPTION_WITHOUT_DOCUMENT':
      return { text: `${formatCount(count, 'receita sem foto ou ficheiro', 'receitas sem foto ou ficheiro')}`, to: writable ? (one ? paths.prescription(one) : paths.prescriptions) : undefined }
    case 'PLAN_WITHOUT_SCHEDULE':
      return { text: `${formatCount(count, 'medicamento sem horários', 'medicamentos sem horários')}`, to: writable ? (one ? paths.medication(one) : paths.medications) : undefined }
    case 'DOSES_UNCONFIRMED':
      return { text: `${formatCount(count, 'toma por confirmar', 'tomas por confirmar')}`, to: writable ? paths.medications : undefined }
    default:
      return { text: 'Há registos por completar' }
  }
}
