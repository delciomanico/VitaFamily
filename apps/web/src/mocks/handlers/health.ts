import { AppError } from '@/lib/errors'
import type { BloodType, HealthProfile, Sex } from '@/types/health'
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

function findMember(familyId: string, memberId: string) {
  // Recurso de outra família ou inexistente → NOT_FOUND (sem enumeração, NFR-SEC-09).
  const member = db.members.find((m) => m.id === memberId && m.familyId === familyId)
  if (!member) throw new AppError('NOT_FOUND')
  return member
}

function buildProfile(familyId: string, memberId: string): HealthProfile {
  return {
    member: findMember(familyId, memberId),
    allergies: db.allergies.filter((a) => a.familyId === familyId && a.memberId === memberId),
    conditions: db.conditions.filter((c) => c.familyId === familyId && c.memberId === memberId),
  }
}

export function getHealthProfile(familyId: string, memberId: string) {
  return respond(() => buildProfile(familyId, memberId))
}

/** Guarda os dados básicos e substitui as listas de alergias e condições pelos nomes indicados. */
export function saveHealthProfile(familyId: string, memberId: string, input: HealthProfileInput) {
  return respond(() => {
    const member = findMember(familyId, memberId)
    member.name = input.name.trim()
    member.birthDate = input.birthDate
    member.sex = input.sex
    member.bloodType = input.bloodType

    const isOther = (item: { familyId: string; memberId: string }) =>
      !(item.familyId === familyId && item.memberId === memberId)

    db.allergies = [
      ...db.allergies.filter(isOther),
      ...input.allergies.map((name) => ({ id: newId('alg'), familyId, memberId, name })),
    ]
    db.conditions = [
      ...db.conditions.filter(isOther),
      ...input.conditions.map((name) => ({ id: newId('cnd'), familyId, memberId, name, kind: 'CONDITION' as const })),
    ]
    return buildProfile(familyId, memberId)
  })
}
