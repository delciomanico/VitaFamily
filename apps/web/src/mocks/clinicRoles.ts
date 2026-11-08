import { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import type { ClinicRole } from '@/types/clinic'
import type { Examination } from '@/types/examination'
import type { MockClinicAccountRecord } from './data/clinicAccounts'
import type { MockClinicPatient, MockClinicVisit } from './data/clinicPatients'
import { db, newId } from './db'

/*
 * Papéis do portal da clínica no backend simulado (BR-CLN-39, authorization.md §6.2b): decisão
 * por **papel + filtro**, nunca só pela UI. O Médico só vê e age em marcações cujo horário é do
 * seu profissional e em pacientes que tenham (ou tiveram) marcação com ele; o resto responde
 * `NOT_FOUND` (sem enumeração) ou `FORBIDDEN` (papel insuficiente).
 */

/** Conta ativa da sessão (qualquer papel); sem sessão válida → UNAUTHENTICATED. */
export function requireAnyAccount(clinicAccountId: string): MockClinicAccountRecord {
  const account = db.clinicAccounts.find((a) => a.id === clinicAccountId)
  if (!account) throw new AppError('INVALID_CREDENTIALS')
  if (account.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED')
  // Um token de Médico sem `professionalId` é inválido (authorization.md §6.2b, nota 5).
  if (account.role === 'CLINIC_DOCTOR' && !account.professionalId) throw new AppError('INVALID_CREDENTIALS')
  return account
}

const STAFF_ROLES: ClinicRole[] = ['CLINIC_ADMIN', 'CLINIC_MANAGER']

/** Rotas só de Admin e Gestor: o Médico recebe `FORBIDDEN`. */
export function requireStaffAccount(clinicAccountId: string): MockClinicAccountRecord {
  const account = requireAnyAccount(clinicAccountId)
  if (!STAFF_ROLES.includes(account.role)) throw new AppError('FORBIDDEN')
  return account
}

/** Rotas só do Admin da clínica (equipa, auditoria, editar perfil). */
export function requireAdminAccount(clinicAccountId: string): MockClinicAccountRecord {
  const account = requireAnyAccount(clinicAccountId)
  if (account.role !== 'CLINIC_ADMIN') throw new AppError('FORBIDDEN')
  return account
}

export const isDoctor = (account: MockClinicAccountRecord) => account.role === 'CLINIC_DOCTOR'

/** Profissional do horário; nos horários antigos sem catálogo, resolve-se pelo nome (só no mock). */
function professionalOf(clinicId: string, slotId?: string, name?: string): string | undefined {
  const slot = slotId ? db.slots.find((s) => s.id === slotId) : undefined
  if (slot?.professionalId) return slot.professionalId
  const fallback = slot?.professionalName ?? name
  return fallback
    ? db.professionals.find((p) => p.clinicId === clinicId && p.name === fallback)?.id
    : undefined
}

export const appointmentProfessional = (a: Appointment) =>
  a.clinicId ? professionalOf(a.clinicId, a.slotId, a.professionalName) : undefined
export const visitProfessional = (v: MockClinicVisit) =>
  v.professionalId ?? professionalOf(v.clinicId, v.slotId, v.professionalName)
export const examProfessional = (e: Examination) => (e.clinicId ? professionalOf(e.clinicId, e.slotId) : undefined)

/** Médico: só o que é do seu profissional; Admin/Gestor: tudo (da clínica). */
const owns = (account: MockClinicAccountRecord, professionalId: string | undefined) =>
  !isDoctor(account) || (professionalId !== undefined && professionalId === account.professionalId)

export const ownsSlot = (account: MockClinicAccountRecord, slot: { id: string; clinicId: string }) =>
  owns(account, professionalOf(slot.clinicId, slot.id))
export const ownsAppointment = (account: MockClinicAccountRecord, a: Appointment) =>
  owns(account, appointmentProfessional(a))
export const ownsVisit = (account: MockClinicAccountRecord, v: MockClinicVisit) => owns(account, visitProfessional(v))
export const ownsExam = (account: MockClinicAccountRecord, e: Examination) => owns(account, examProfessional(e))

/** Paciente com (ou que teve) marcação com o profissional do Médico (BR-CLN-39). */
export function ownsPatient(account: MockClinicAccountRecord, patient: MockClinicPatient): boolean {
  if (!isDoctor(account)) return true
  return (
    db.appointments.some(
      (a) => a.clinicId === patient.clinicId && patient.memberId && a.memberId === patient.memberId && ownsAppointment(account, a),
    ) ||
    db.clinicVisits.some((v) => v.clinicId === patient.clinicId && v.clinicPatientId === patient.id && ownsVisit(account, v)) ||
    db.examinations.some(
      (e) => e.clinicId === patient.clinicId && e.slotId && patient.memberId && e.memberId === patient.memberId && ownsExam(account, e),
    )
  )
}

/** O Médico nunca recebe `receiptId` (BR-CLN-39, nota 1). */
export function scrubReceipt<T extends { receiptId?: string }>(account: MockClinicAccountRecord, item: T): T {
  if (!isDoctor(account) || item.receiptId === undefined) return item
  const { receiptId: _hidden, ...rest } = item
  return rest as T
}

/** Regista uma ação da conta na auditoria da clínica (BR-CLN-40): só identificadores, nunca dados pessoais. */
export function recordClinicAudit(
  account: MockClinicAccountRecord,
  action: string,
  resourceType: string,
  resourceId: string | null = null,
  result: 'SUCCESS' | 'DENIED' | 'FAILURE' = 'SUCCESS',
  now: Date = new Date(),
) {
  db.clinicAudit.push({
    id: newId('aud'),
    clinicId: account.clinicId,
    occurredAt: now.toISOString(),
    action,
    resourceType,
    resourceId,
    result,
    actorAccountId: account.id,
  })
}
