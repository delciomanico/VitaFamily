import { AppError } from '@/lib/errors'
import { dosesOnDay, nextDoseAt } from '@/lib/medication'
import { todayISO } from '@/lib/date'
import type { MedicationDetail, MedicationPlan, MedicationSummary } from '@/types/medication'
import type { DocumentUpload } from '@/types/document'
import type { Prescription, PrescriptionDetail, PrescriptionStatus, PrescriptionSummary } from '@/types/prescription'
import { findVisibleMember, memberName, visibleMemberIds } from '../access'
import { db, newId } from '../db'
import { attachDocuments, documentsOf, validateUploads } from '../documents'
import { respond } from '../respond'

/** Horários de um medicamento: horas fixas ou “de X em X horas” a partir da primeira toma (BR-MED-01). */
export type ScheduleInput =
  | { scheduleType: 'FIXED_TIMES'; times: string[] }
  | { scheduleType: 'INTERVAL'; intervalHours: number; firstTime: string }

interface MedicationBaseInput {
  name: string
  dosage: string
  notes?: string
  /** BR-MED-02: uso contínuo, ou com fim. */
  continuous: boolean
}

export type NewMedicationInput = MedicationBaseInput & ScheduleInput & { durationDays?: number }

export type UpdateMedicationInput = MedicationBaseInput & ScheduleInput & { endDate?: string }

export interface NewPrescriptionInput {
  memberId: string
  issuedOn: string
  doctorName?: string
  clinicName?: string
  notes?: string
  medications: NewMedicationInput[]
  documents: DocumentUpload[]
}

const TIME_PATTERN = /^\d{2}:\d{2}$/

/** Receitas e planos são do titular ou de um dependente do utilizador; outros → NOT_FOUND. */
function inScope(familyId: string, userId: string) {
  const visible = new Set(visibleMemberIds(familyId, userId))
  return (item: { familyId: string; memberId: string }) => item.familyId === familyId && visible.has(item.memberId)
}

function findPrescription(familyId: string, userId: string, id: string): Prescription {
  const prescription = db.prescriptions.find((p) => p.id === id)
  if (!prescription || !inScope(familyId, userId)(prescription)) throw new AppError('NOT_FOUND')
  return prescription
}

function findPlan(familyId: string, userId: string, id: string): MedicationPlan {
  const plan = db.medicationPlans.find((p) => p.id === id)
  if (!plan || !inScope(familyId, userId)(plan)) throw new AppError('NOT_FOUND')
  return plan
}

/** Instante ISO do dia `date` à hora local `time` (HH:mm). */
function atLocal(time: string, date: Date): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const result = new Date(date)
  result.setHours(hours, minutes, 0, 0)
  return result.toISOString()
}

function endOfDay(date: Date): string {
  const result = new Date(date)
  result.setHours(23, 59, 0, 0)
  return result.toISOString()
}

function validateSchedule(input: ScheduleInput) {
  if (input.scheduleType === 'FIXED_TIMES') {
    const unique = new Set(input.times)
    if (
      input.times.length === 0 ||
      unique.size !== input.times.length ||
      !input.times.every((t) => TIME_PATTERN.test(t))
    )
      throw new AppError('VALIDATION_ERROR')
  } else if (!TIME_PATTERN.test(input.firstTime) || !(input.intervalHours > 0 && 24 % input.intervalHours === 0)) {
    throw new AppError('VALIDATION_ERROR')
  }
}

/** Campos de horário do plano a partir do formulário. */
function scheduleFields(input: ScheduleInput): Pick<MedicationPlan, 'scheduleType' | 'times' | 'intervalHours'> {
  return input.scheduleType === 'FIXED_TIMES'
    ? { scheduleType: 'FIXED_TIMES', times: [...input.times].sort(), intervalHours: undefined }
    : { scheduleType: 'INTERVAL', times: undefined, intervalHours: input.intervalHours }
}

/** Primeira hora do dia em que o plano começa (a do início do plano, nos intervalos). */
function firstTimeOf(input: ScheduleInput): string {
  if (input.scheduleType === 'INTERVAL') return input.firstTime
  return [...input.times].sort()[0] ?? '00:00'
}

/** Remove as tomas futuras ainda pendentes do plano (o passado não é reescrito, BR-RX-05). */
function dropFutureDoses(plan: MedicationPlan, now: Date) {
  db.doses = db.doses.filter(
    (d) => d.planId !== plan.id || d.status !== 'PENDING' || Date.parse(d.scheduledAt) <= now.getTime(),
  )
}

/**
 * Gera as tomas que faltam hoje (os mocks só têm o dia corrente; o backend gera em janela).
 * Só cria tomas futuras e não duplica as que já existem.
 */
function generateTodayDoses(plan: MedicationPlan, now: Date) {
  if (plan.status !== 'ACTIVE') return
  const existing = new Set(db.doses.filter((d) => d.planId === plan.id).map((d) => d.scheduledAt))
  for (const scheduledAt of dosesOnDay(plan, now)) {
    if (Date.parse(scheduledAt) <= now.getTime() || existing.has(scheduledAt)) continue
    db.doses.push({
      id: newId('dose'),
      familyId: plan.familyId,
      memberId: plan.memberId,
      planId: plan.id,
      scheduledAt,
      status: 'PENDING',
    })
  }
}

function endPlan(plan: MedicationPlan, now: Date) {
  if (plan.status === 'ENDED') return
  plan.status = 'ENDED'
  plan.endedAt = now.toISOString()
  dropFutureDoses(plan, now)
}

/** Vista do medicamento na lista (também usada no perfil do membro). */
export function summarize(plan: MedicationPlan, now: Date): MedicationSummary {
  const next = nextDoseAt(plan, now)
  return { plan, memberName: memberName(plan.memberId), nextDoseAt: next, remindersOn: next !== null }
}

/** Receitas visíveis, mais recentes primeiro (UC-RX-03). */
export function listPrescriptions(familyId: string, userId: string) {
  return respond((): PrescriptionSummary[] =>
    db.prescriptions
      .filter(inScope(familyId, userId))
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
      .map((prescription) => ({
        prescription,
        memberName: memberName(prescription.memberId),
        medicationCount: db.medicationPlans.filter((p) => p.prescriptionId === prescription.id).length,
      })),
  )
}

export function getPrescription(familyId: string, userId: string, id: string) {
  return respond((): PrescriptionDetail => {
    const prescription = findPrescription(familyId, userId, id)
    return {
      prescription,
      memberName: memberName(prescription.memberId),
      medications: db.medicationPlans.filter((p) => p.prescriptionId === id),
      documents: documentsOf('PRESCRIPTION', id),
    }
  })
}

/**
 * Regista a receita ATIVA e cria um plano de toma por medicamento (UC-RX-01, BR-RX-01/02).
 * Os planos começam hoje; as tomas de hoje já passadas não são criadas.
 */
export function createPrescription(
  familyId: string,
  userId: string,
  input: NewPrescriptionInput,
  now: Date = new Date(),
) {
  return respond((): Prescription => {
    findVisibleMember(familyId, userId, input.memberId)
    if (input.issuedOn > todayISO(now) || input.medications.length === 0) throw new AppError('VALIDATION_ERROR')
    validateUploads(input.documents)
    input.medications.forEach(validateSchedule)

    const prescription: Prescription = {
      id: newId('rx'),
      familyId,
      memberId: input.memberId,
      issuedOn: input.issuedOn,
      doctorName: input.doctorName?.trim() || undefined,
      clinicName: input.clinicName?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      status: 'ACTIVE',
    }
    db.prescriptions.push(prescription)

    for (const medication of input.medications) {
      const days = medication.continuous ? undefined : (medication.durationDays ?? 1)
      const lastDay = new Date(now)
      if (days) lastDay.setDate(lastDay.getDate() + days - 1)
      const plan: MedicationPlan = {
        id: newId('med'),
        familyId,
        memberId: input.memberId,
        prescriptionId: prescription.id,
        name: medication.name.trim(),
        dosage: medication.dosage.trim(),
        ...scheduleFields(medication),
        startAt: atLocal(firstTimeOf(medication), now),
        endAt: days ? endOfDay(lastDay) : undefined,
        continuous: medication.continuous,
        notes: medication.notes?.trim() || undefined,
        status: 'ACTIVE',
      }
      db.medicationPlans.push(plan)
      generateTodayDoses(plan, now)
    }

    attachDocuments(
      input.documents,
      { familyId, memberId: input.memberId, resourceType: 'PRESCRIPTION', resourceId: prescription.id },
      now,
    )
    return prescription
  })
}

/** Concluir ou cancelar termina os planos associados; o histórico de tomas mantém-se (BR-RX-04). */
export function setPrescriptionStatus(
  familyId: string,
  userId: string,
  id: string,
  status: Exclude<PrescriptionStatus, 'ACTIVE'>,
  now: Date = new Date(),
) {
  return respond((): Prescription => {
    const prescription = findPrescription(familyId, userId, id)
    if (prescription.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR')
    prescription.status = status
    db.medicationPlans.filter((p) => p.prescriptionId === id).forEach((plan) => endPlan(plan, now))
    return prescription
  })
}

/** Medicamentos visíveis, ordenados pela próxima toma (UC-MED-02). */
export function listMedications(familyId: string, userId: string, now: Date = new Date()) {
  return respond((): MedicationSummary[] =>
    db.medicationPlans
      .filter(inScope(familyId, userId))
      .map((plan) => summarize(plan, now))
      .sort(
        (a, b) => (a.nextDoseAt ?? '9').localeCompare(b.nextDoseAt ?? '9') || a.plan.name.localeCompare(b.plan.name),
      ),
  )
}

export function getMedication(familyId: string, userId: string, id: string, now: Date = new Date()) {
  return respond((): MedicationDetail => {
    const plan = findPlan(familyId, userId, id)
    const prescription = db.prescriptions.find((p) => p.id === plan.prescriptionId)
    return {
      ...summarize(plan, now),
      prescription: prescription && {
        id: prescription.id,
        issuedOn: prescription.issuedOn,
        doctorName: prescription.doctorName,
      },
    }
  })
}

/** Editar só afeta as tomas futuras (BR-RX-05). */
export function updateMedication(
  familyId: string,
  userId: string,
  id: string,
  input: UpdateMedicationInput,
  now: Date = new Date(),
) {
  return respond((): MedicationPlan => {
    const plan = findPlan(familyId, userId, id)
    if (plan.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR')
    validateSchedule(input)
    if (!input.continuous && (!input.endDate || input.endDate < todayISO(now))) throw new AppError('VALIDATION_ERROR')

    plan.name = input.name.trim()
    plan.dosage = input.dosage.trim()
    plan.notes = input.notes?.trim() || undefined
    Object.assign(plan, scheduleFields(input))
    if (input.scheduleType === 'INTERVAL') {
      // A hora da primeira toma vive no início do plano; mantém-se o dia de início.
      plan.startAt = atLocal(input.firstTime, new Date(plan.startAt))
    }
    plan.continuous = input.continuous
    plan.endAt = input.continuous || !input.endDate ? undefined : endOfDay(new Date(`${input.endDate}T00:00`))

    dropFutureDoses(plan, now)
    generateTodayDoses(plan, now)
    return plan
  })
}

/** Desativar = terminar o plano: tomas futuras removidas, histórico mantido (UC-MED-04). */
export function endMedication(familyId: string, userId: string, id: string, now: Date = new Date()) {
  return respond((): MedicationPlan => {
    const plan = findPlan(familyId, userId, id)
    endPlan(plan, now)
    return plan
  })
}
