import { todayISO } from '@/lib/date'
import { AppError } from '@/lib/errors'
import type { HistoryEntry } from '@/types/history'
import type { BloodType, HealthProfile, Sex } from '@/types/health'
import { visibleMemberIds } from '../access'
import { db, newId } from '../db'
import { respond } from '../respond'

export interface HealthProfileInput {
  name: string
  birthDate: string
  sex?: Sex
  bloodType?: BloodType
  allergies: string[]
  conditions: string[]
}

/**
 * Membro cujos dados o utilizador pode ver e gerir (o próprio ou um dependente seu, BR-MEM-08).
 * Sem permissão ou de outra família → NOT_FOUND (sem enumeração, NFR-SEC-09).
 */
function findVisibleMember(familyId: string, userId: string, memberId: string) {
  if (!visibleMemberIds(familyId, userId).includes(memberId)) throw new AppError('NOT_FOUND')
  const member = db.members.find((m) => m.id === memberId && m.familyId === familyId)
  if (!member) throw new AppError('NOT_FOUND')
  return member
}

const ofMember = (familyId: string, memberId: string) => (item: { familyId: string; memberId: string }) =>
  item.familyId === familyId && item.memberId === memberId

function buildProfile(familyId: string, userId: string, memberId: string): HealthProfile {
  const owned = ofMember(familyId, memberId)
  return {
    member: findVisibleMember(familyId, userId, memberId),
    allergies: db.allergies.filter(owned),
    // O perfil mostra as condições atuais; o histórico (HISTORY) vai para o histórico médico.
    conditions: db.conditions.filter((c) => owned(c) && c.kind === 'CONDITION'),
  }
}

export function getHealthProfile(familyId: string, userId: string, memberId: string) {
  return respond(() => buildProfile(familyId, userId, memberId))
}

/** Guarda os dados básicos e substitui alergias e condições atuais pelos nomes indicados. */
export function saveHealthProfile(familyId: string, userId: string, memberId: string, input: HealthProfileInput) {
  return respond(() => {
    const member = findVisibleMember(familyId, userId, memberId)
    member.name = input.name.trim()
    member.birthDate = input.birthDate
    member.sex = input.sex
    member.bloodType = input.bloodType

    const owned = ofMember(familyId, memberId)
    db.allergies = [
      ...db.allergies.filter((a) => !owned(a)),
      ...input.allergies.map((name) => ({ id: newId('alg'), familyId, memberId, name })),
    ]
    db.conditions = [
      ...db.conditions.filter((c) => !owned(c) || c.kind !== 'CONDITION'),
      ...input.conditions.map((name) => ({ id: newId('cnd'), familyId, memberId, name, kind: 'CONDITION' as const })),
    ]
    return buildProfile(familyId, userId, memberId)
  })
}

/** Histórico médico: consultas e exames passados, receitas e antecedentes, mais recentes primeiro. */
export function getMedicalHistory(familyId: string, userId: string, memberId: string, now: Date = new Date()) {
  return respond((): HistoryEntry[] => {
    findVisibleMember(familyId, userId, memberId)
    const owned = ofMember(familyId, memberId)
    const today = todayISO(now)

    const appointments = db.appointments
      .filter((a) => owned(a) && Date.parse(a.scheduledAt) <= now.getTime())
      .map((a): HistoryEntry => ({
        id: a.id,
        kind: 'APPOINTMENT',
        title: a.specialty ?? a.reason ?? 'Consulta',
        subtitle: a.clinicName,
        date: a.scheduledAt,
      }))

    const examinations = db.examinations
      .filter((e) => owned(e) && e.examDate <= today)
      .map((e): HistoryEntry => ({ id: e.id, kind: 'EXAMINATION', title: e.name, subtitle: e.clinicName, date: e.examDate }))

    const prescriptions = db.prescriptions
      .filter(owned)
      .map((p): HistoryEntry => ({
        id: p.id,
        kind: 'PRESCRIPTION',
        title: 'Receita',
        subtitle: p.doctorName,
        date: p.issuedOn,
      }))

    const history = db.conditions
      .filter((c) => owned(c) && c.kind === 'HISTORY' && c.since)
      .map((c): HistoryEntry => ({ id: c.id, kind: 'HISTORY', title: c.name, subtitle: c.notes, date: c.since ?? '' }))

    return [...appointments, ...examinations, ...prescriptions, ...history].sort((a, b) => b.date.localeCompare(a.date))
  })
}
