import { AppError } from '@/lib/errors'
import { formatLongDate, formatTime } from '@/lib/format'
import {
  REPORT_LIMITS,
  REPORT_SECTIONS,
  type ClinicExamResultsDraftInput,
  type ConsultationReportInput,
  type ExamDraftResult,
} from '@/types/clinicReport'
import type { Appointment } from '@/types/appointment'
import { db } from './db'
import type { MockConsultationReport } from './db'

/*
 * Regras puras do relatório da consulta e do laudo no backend simulado (M15, ADR-027). Nada aqui
 * depende dos handlers, para que `clinicPortal` (concluir) e `clinicReports` (rotas) a partilhem.
 */

export const REPORT_FOOTER = 'Documento não fiscal. Não substitui receita médica nem atestado.'
export const REPORT_DRAFT_MARK = 'RASCUNHO — sem valor'
export const REFERENCE_DISCLAIMER =
  'A indicação «Fora da referência» resulta apenas da comparação aritmética do valor com os limites de referência indicados pela clínica; não constitui interpretação clínica nem diagnóstico. A interpretação cabe ao médico.'

/** Caracteres de controlo exceto quebra de linha (BR-CLN-41). */
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/

export function reportOfBooking(clinicId: string, bookingId: string): MockConsultationReport | undefined {
  return db.consultationReports.find((r) => r.clinicId === clinicId && r.bookingId === bookingId)
}

/** Estado do relatório de uma marcação (ids únicos); ausente = sem relatório. */
export const reportStatusOf = (bookingId: string) => db.consultationReports.find((r) => r.bookingId === bookingId)?.status

/** Normaliza e valida as secções: vazias = nulas, limites do contrato, ≥1 preenchida. */
export function cleanSections(input: ConsultationReportInput): Partial<Record<(typeof REPORT_SECTIONS)[number], string>> {
  const out: Partial<Record<(typeof REPORT_SECTIONS)[number], string>> = {}
  for (const section of REPORT_SECTIONS) {
    const value = (input[section] ?? '').replace(/\r\n/g, '\n').trim()
    if (!value) continue
    if (value.length > REPORT_LIMITS[section] || CONTROL.test(value)) throw new AppError('VALIDATION_ERROR')
    out[section] = value
  }
  if (Object.keys(out).length === 0) throw new AppError('VALIDATION_ERROR')
  return out
}

/** Relatório partilhado e FINAL de uma consulta Vita (BR-CLN-45). */
export function sharedFinalReportOf(appointment: Pick<Appointment, 'id' | 'clinicId'>): MockConsultationReport | undefined {
  if (!appointment.clinicId) return undefined
  const report = reportOfBooking(appointment.clinicId, appointment.id)
  return report && report.status === 'FINAL' && report.sharedWithPatient && report.bookingKind === 'APPOINTMENT'
    ? report
    : undefined
}

const when = (iso: string) => `${formatLongDate(iso)} ${formatTime(iso)}`

/** Linhas do PDF do relatório (a pedido, não se guarda): só secções preenchidas, adendas e assinatura. */
export function reportPdfLines(report: MockConsultationReport, clinicName: string): string[] {
  const titles: Record<(typeof REPORT_SECTIONS)[number], string> = {
    reason: 'Motivo da consulta',
    findings: 'Achados',
    impression: 'Diagnóstico / impressão',
    plan: 'Conduta / plano',
  }
  const lines = [clinicName, 'RELATÓRIO DA CONSULTA']
  if (report.status === 'DRAFT') lines.push(REPORT_DRAFT_MARK)
  lines.push('', `Paciente: ${report.patientName}`, `Data: ${when(report.consultationAt)}`)
  if (report.specialty) lines.push(`Especialidade: ${report.specialty}`)
  for (const section of REPORT_SECTIONS) {
    const text = report[section]
    if (text) lines.push('', titles[section], text)
  }
  if (report.addenda.length > 0) {
    lines.push('', 'Adendas')
    for (const a of report.addenda) lines.push(`${when(a.createdAt)} — ${a.authorName}`, a.text)
  }
  lines.push(
    '',
    `${report.authorName}${report.specialty ? ` — ${report.specialty}` : ''}${
      report.finalizedAt ? ` · finalizado em ${when(report.finalizedAt)}` : ''
    }`,
    '',
    REPORT_FOOTER,
  )
  return lines
}

/** Única indicação aritmética: valor numérico fora dos limites indicados (estrito); só no PDF (BR-CLN-48). */
export function isOutOfReference(result: Pick<ExamDraftResult, 'valueNumeric' | 'referenceMin' | 'referenceMax'>): boolean {
  const { valueNumeric: v, referenceMin: min, referenceMax: max } = result
  if (v === undefined) return false
  return (min !== undefined && v < min) || (max !== undefined && v > max)
}

/** Valida o esquema de `ExamResultInput` (BR-CLN-08/47). */
export function validateExamResults(results: ExamDraftResult[]) {
  if (results.length > 50) throw new AppError('VALIDATION_ERROR')
  for (const result of results) {
    const hasValue = result.valueNumeric !== undefined || Boolean(result.valueText?.trim())
    const { referenceMin: min, referenceMax: max } = result
    if (!result.parameter.trim() || !hasValue || (min !== undefined && max !== undefined && min > max)) {
      throw new AppError('VALIDATION_ERROR')
    }
  }
}

export function validateExamDraft(input: ClinicExamResultsDraftInput) {
  validateExamResults(input.results)
  if (input.results.length === 0 && !input.resultNote?.trim()) throw new AppError('VALIDATION_ERROR')
  if ((input.resultNote ?? '').length > 2000) throw new AppError('VALIDATION_ERROR')
}

/** Linhas do laudo: tabela parâmetro / valor / unidade / referência; o realce vive só aqui. */
export function examReportLines(args: {
  clinicName: string
  patientName: string
  examName: string
  examAt: string
  professionalName?: string
  results: ExamDraftResult[]
  resultNote?: string
  issuedAt: string
}): string[] {
  const { results } = args
  const structured = results.filter((r) => r.valueNumeric !== undefined)
  const texts = results.filter((r) => r.valueNumeric === undefined)
  const lines = [args.clinicName, 'LAUDO DE EXAME', '', `Paciente: ${args.patientName}`, `Exame: ${args.examName}`, `Data: ${when(args.examAt)}`]
  if (args.professionalName) lines.push(`Profissional: ${args.professionalName}`)
  lines.push('', 'Parâmetro | Valor | Unidade | Referência')
  let anyOut = false
  for (const r of structured) {
    const reference =
      r.referenceMin !== undefined || r.referenceMax !== undefined ? `${r.referenceMin ?? '…'} – ${r.referenceMax ?? '…'}` : '—'
    const out = isOutOfReference(r)
    anyOut ||= out
    lines.push(`${r.parameter} | ${r.valueNumeric} | ${r.unit ?? '—'} | ${reference}${out ? ' | Fora da referência' : ''}`)
  }
  for (const r of texts) lines.push(`${r.parameter}: ${r.valueText}${r.unit ? ` ${r.unit}` : ''}`)
  if (args.resultNote?.trim()) lines.push('', `Nota: ${args.resultNote.trim()}`)
  if (anyOut) lines.push('', REFERENCE_DISCLAIMER)
  lines.push('', `Emitido em ${when(args.issuedAt)}`, '', REPORT_FOOTER)
  return lines
}
