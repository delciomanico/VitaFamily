import { todayISO } from './date'
import type { DraftMedication, DraftResult, ExamDraft, PrescriptionDraft } from './ocrParse'
import { draftId, frequencyIsMapped } from './ocrReview'

/*
 * Do rascunho lido para os valores iniciais dos formulários de receita e exame (BR-OCR-06/08): só o que o documento
 * diz; o que não foi lido fica com o valor por omissão do formulário. Estas funções só preparam valores: nada é
 * guardado sem o utilizador rever e guardar (BR-OCR-11).
 */

export interface PrefillSchedule {
  scheduleType: 'FIXED_TIMES' | 'INTERVAL'
  times: string[]
  intervalHours: string
  firstTime: string
}

const DEFAULT_TIMES: Record<number, string[]> = {
  1: ['08:00'],
  2: ['08:00', '20:00'],
  3: ['08:00', '14:00', '22:00'],
  4: ['06:00', '12:00', '18:00', '22:00'],
}

export function scheduleFromDraft(frequency: DraftMedication['frequency']): PrefillSchedule {
  const base: PrefillSchedule = { scheduleType: 'FIXED_TIMES', times: ['08:00'], intervalHours: '8', firstTime: '08:00' }
  const value = frequency?.value
  if (value?.intervalHours) return { ...base, scheduleType: 'INTERVAL', intervalHours: String(value.intervalHours) }
  if (value?.perDay) return { ...base, times: DEFAULT_TIMES[value.perDay] ?? base.times }
  return base
}

export interface PrefillMedication {
  ocrId: string
  name: string
  dosage: string
  schedule: PrefillSchedule
  continuous: boolean
  durationDays: string
  notes: string
}

export function medicationFromDraft(m: DraftMedication, index: number): PrefillMedication {
  // Frequência que a app não suporta («5 em 5 horas»): vai para as observações, como está no documento.
  const notes = [m.notes?.value, frequencyIsMapped(m) ? null : m.frequency?.value.text].filter(Boolean).join('; ')
  return {
    ocrId: draftId(index, 'm'),
    name: m.name.value,
    dosage: m.dosage?.value ?? '',
    schedule: scheduleFromDraft(m.frequency),
    continuous: m.duration?.value.continuous ?? false,
    durationDays: String(m.duration?.value.days ?? 7),
    notes,
  }
}

/** Uma data futura não serve numa receita já emitida: fica a de hoje (e o utilizador corrige). */
export function prescriptionDefaults(draft: PrescriptionDraft | null) {
  const date = draft?.issuedOn?.value
  return {
    issuedOn: date && date <= todayISO() ? date : todayISO(),
    doctorName: draft?.doctorName?.value ?? '',
    clinicName: draft?.clinicName?.value ?? '',
    notes: draft?.notes?.value ?? '',
    medications: draft?.medications.map(medicationFromDraft) ?? [],
  }
}

export interface PrefillResult {
  ocrId: string
  parameter: string
  value: string
  unit: string
  referenceMin: string
  referenceMax: string
}

export function resultFromDraft(r: DraftResult, index: number): PrefillResult {
  return {
    ocrId: draftId(index, 'r'),
    parameter: r.parameter.value,
    value: r.value.value,
    unit: r.unit?.value ?? '',
    referenceMin: r.referenceMin?.value ?? '',
    referenceMax: r.referenceMax?.value ?? '',
  }
}

export function examinationDefaults(draft: ExamDraft | null) {
  return {
    name: draft?.name?.value ?? '',
    examDate: draft?.examDate?.value ?? todayISO(),
    clinicName: draft?.labName?.value ?? '',
    results: draft?.results.map(resultFromDraft) ?? [],
  }
}
