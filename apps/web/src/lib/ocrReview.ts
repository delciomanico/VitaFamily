import { CONFIDENCE_THRESHOLD } from './ocrConfig'
import type { DraftMedication, DraftResult, ExamDraft, Field, PrescriptionDraft } from './ocrParse'

/*
 * Revisão obrigatória (BR-OCR-07/08): que campos do rascunho levam «Confirmar» e quando ficam resolvidos.
 * Um campo assinalado fica resolvido quando o utilizador o confirma ou o edita (o valor atual deixa de ser o lido).
 * Funções puras; as chaves são estáveis para sobreviverem a remover/reordenar linhas do formulário.
 */

/** Uma linha da lista «o que encontrámos». */
export interface ReviewRow {
  key: string
  label: string
  value: string
  confidence: number
  /** Leva «Confirmar»: confiança < 0,70 ou valor que o formulário não consegue representar tal como está. */
  needsConfirm: boolean
}

export interface ReviewPlan {
  rows: ReviewRow[]
  /** Chaves marcadas → valor lido (serializado), para detetar edição. */
  marked: Record<string, string>
}

const low = (confidence: number) => confidence < CONFIDENCE_THRESHOLD

function row(key: string, label: string, f: Field | undefined, force = false, display?: string): ReviewRow | null {
  if (!f) return null
  return { key, label, value: display ?? f.value, confidence: f.confidence, needsConfirm: force || low(f.confidence) }
}

const compact = (rows: (ReviewRow | null)[]) => rows.filter((r): r is ReviewRow => r !== null)

export const medKey = (id: string, part: 'name' | 'dosage' | 'frequency' | 'duration' | 'notes') => `med:${id}:${part}`
export const resultKey = (id: string) => `res:${id}`

/** Identificadores estáveis: `m0`, `m1`… pela ordem em que foram lidos. */
export const draftId = (index: number, prefix: 'm' | 'r') => `${prefix}${index}`

/** Frequência sem horário equivalente na app («5 em 5 horas») entra nas observações e pede confirmação. */
export const frequencyIsMapped = (m: DraftMedication) => !m.frequency || m.frequency.value.intervalHours !== undefined || m.frequency.value.perDay !== undefined

export function durationText(d: NonNullable<DraftMedication['duration']>['value']): string {
  return d.continuous ? 'Uso contínuo' : `${d.days} ${d.days === 1 ? 'dia' : 'dias'}`
}

/** Texto do resultado para a lista: «Glicemia — 98 mg/dL (70–99)». */
export function resultSummary(r: DraftResult): string {
  const ref = r.referenceMin && r.referenceMax ? `${r.referenceMin.value}–${r.referenceMax.value}` : r.referenceMax ? `até ${r.referenceMax.value}` : r.referenceMin ? `desde ${r.referenceMin.value}` : ''
  return [`${r.parameter.value} — ${r.value.value}${r.unit ? ` ${r.unit.value}` : ''}`, ref && `(${ref})`].filter(Boolean).join(' ')
}

/** Confiança de uma linha de resultado = a pior dos seus campos (a linha é confirmada de uma vez). */
export const resultConfidence = (r: DraftResult): number =>
  Math.min(...[r.parameter, r.value, r.unit, r.referenceMin, r.referenceMax].filter((f): f is Field => !!f).map((f) => f.confidence))

export function planPrescriptionReview(draft: PrescriptionDraft, initial: (key: string) => string): ReviewPlan {
  const rows = compact([
    row('issuedOn', 'Data da receita', draft.issuedOn),
    row('doctorName', 'Médico', draft.doctorName),
    row('clinicName', 'Clínica', draft.clinicName),
    ...draft.medications.flatMap((m, i) => {
      const id = draftId(i, 'm')
      const n = `Medicamento ${i + 1}`
      return [
        row(medKey(id, 'name'), `${n} · Nome`, m.name),
        row(medKey(id, 'dosage'), `${n} · Dosagem`, m.dosage),
        row(medKey(id, 'frequency'), `${n} · Frequência`, m.frequency && { value: m.frequency.value.text, confidence: m.frequency.confidence }, !frequencyIsMapped(m)),
        row(medKey(id, 'duration'), `${n} · Duração`, m.duration && { value: durationText(m.duration.value), confidence: m.duration.confidence }),
        row(medKey(id, 'notes'), `${n} · Observações`, m.notes),
      ]
    }),
    row('notes', 'Observações', draft.notes),
  ])
  return { rows, marked: Object.fromEntries(rows.filter((r) => r.needsConfirm).map((r) => [r.key, initial(r.key)])) }
}

export function planExaminationReview(draft: ExamDraft, initial: (key: string) => string): ReviewPlan {
  const rows = compact([
    row('name', 'Tipo de exame', draft.name),
    row('examDate', 'Data', draft.examDate),
    row('labName', 'Laboratório', draft.labName),
    ...draft.results.map((r, i) => row(resultKey(draftId(i, 'r')), `Resultado ${i + 1}`, { value: resultSummary(r), confidence: resultConfidence(r) })),
  ])
  return { rows, marked: Object.fromEntries(rows.filter((r) => r.needsConfirm).map((r) => [r.key, initial(r.key)])) }
}

/**
 * Chaves ainda por resolver: marcadas, não confirmadas e cujo valor atual continua igual ao lido.
 * `current(key)` devolve o valor atual serializado, ou `undefined` se a linha foi removida (resolvido).
 */
export function unresolvedKeys(marked: Record<string, string>, confirmed: ReadonlySet<string>, current: (key: string) => string | undefined): string[] {
  return Object.entries(marked)
    .filter(([key, initial]) => !confirmed.has(key) && current(key) === initial)
    .map(([key]) => key)
}
