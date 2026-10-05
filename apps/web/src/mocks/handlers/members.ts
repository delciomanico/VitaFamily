import { AppError } from '@/lib/errors'
import type { Appointment } from '@/types/appointment'
import type { FamilyMember, FamilyMemberCard, FamilyOverview, PublicMember } from '@/types/family'
import type { HistoryEntry } from '@/types/history'
import type { MemberProfile } from '@/types/member'
import { SHARING_CATEGORIES, type SharingCategory } from '@/types/sharing'
import { memberAccess, memberName, requireSelf, visibleMemberIds } from '../access'
import { expireRequests } from '../bookings'
import { db } from '../db'
import { respond } from '../respond'
import { historyEntries } from './health'
import { summarize } from './medications'
import { pendingItems } from './reports'

/** Quantos itens recentes cada secção de “Atividade” mostra no perfil do membro. */
export const PROFILE_ACTIVITY_LIMIT = 3

/** Só C1 e a estrutura familiar (BR-PRV-10): nunca tipo sanguíneo nem outros dados de saúde. */
export function toPublic(member: FamilyMember): PublicMember {
  return {
    id: member.id,
    name: member.name,
    birthDate: member.birthDate,
    relationship: member.relationship,
    role: member.role,
    isDependent: member.isDependent,
    hasAccount: Boolean(member.userId),
  }
}

/** Próximas primeiro (por data), depois as passadas (mais recentes primeiro). */
export const upcomingFirst = (now: Date) => (a: Appointment, b: Appointment) => {
  const aFuture = Date.parse(a.scheduledAt) > now.getTime()
  const bFuture = Date.parse(b.scheduledAt) > now.getTime()
  if (aFuture !== bFuture) return aFuture ? -1 : 1
  return aFuture ? a.scheduledAt.localeCompare(b.scheduledAt) : b.scheduledAt.localeCompare(a.scheduledAt)
}

const ofMember = (familyId: string, memberId: string) => (item: { familyId: string; memberId: string }) =>
  item.familyId === familyId && item.memberId === memberId

/** Minha família (UC-FAM-05): membros com idade, relação e estado de acompanhamento. */
export function getFamilyOverview(familyId: string, userId: string, now: Date = new Date()) {
  return respond((): FamilyOverview => {
    const self = requireSelf(familyId, userId)
    const family = db.families.find((f) => f.id === familyId)
    if (!family) throw new AppError('NOT_FOUND')
    const managed = new Set(visibleMemberIds(familyId, userId))
    const pending = pendingItems(familyId, [...managed], now)

    const members = db.members
      .filter((m) => m.familyId === familyId && m.status === 'ACTIVE')
      // O próprio primeiro, depois os que gere, depois os restantes.
      .sort(
        (a, b) =>
          Number(b.id === self.id) - Number(a.id === self.id) || Number(managed.has(b.id)) - Number(managed.has(a.id)),
      )
      .map((member): FamilyMemberCard => {
        const manage = managed.has(member.id)
        const count = pending.filter((p) => p.memberId === member.id).length
        return {
          member: toPublic(member),
          isSelf: member.id === self.id,
          manage,
          tracking: manage
            ? count > 0
              ? { kind: 'PENDING', count }
              : { kind: 'UP_TO_DATE' }
            : { kind: 'SHARED', categories: [...memberAccess(familyId, userId, member.id).categories] },
        }
      })

    return { family, isAdmin: self.role === 'FAMILY_ADMIN', members }
  })
}

/**
 * Perfil do membro (UC-PRV-02): saúde (condições, alergias, medicamentos) e atividade (consultas,
 * exames, receitas), cada secção só se o utilizador a puder ver. Partilha = só leitura (BR-PRV-03).
 */
export function getMemberProfile(familyId: string, userId: string, memberId: string, now: Date = new Date()) {
  return respond((): MemberProfile => {
    const self = requireSelf(familyId, userId)
    const { manage, categories } = memberAccess(familyId, userId, memberId)
    const member = db.members.find((m) => m.id === memberId && m.familyId === familyId)
    if (!member) throw new AppError('NOT_FOUND')
    expireRequests(now)
    const owned = ofMember(familyId, memberId)
    const can = (category: SharingCategory) => categories.has(category)
    const recent = <T>(items: T[]) => items.slice(0, PROFILE_ACTIVITY_LIMIT)

    const appointments = db.appointments
      .filter((a) => owned(a) && ['REQUESTED', 'SCHEDULED', 'COMPLETED', 'NO_SHOW'].includes(a.status))
      .sort(upcomingFirst(now))

    return {
      member: toPublic(member),
      isSelf: member.id === self.id,
      manage,
      canRemove: self.role === 'FAMILY_ADMIN' && member.id !== self.id && member.isDependent && !member.userId,
      guardians: db.guardianships
        .filter((g) => g.familyId === familyId && g.dependentId === memberId)
        .map((g) => memberName(g.guardianId)),
      access: SHARING_CATEGORIES.filter(can),
      bloodType: can('ALLERGIES') ? member.bloodType : undefined,
      allergies: can('ALLERGIES') ? db.allergies.filter(owned).map((a) => a.name) : undefined,
      conditions: can('CONDITIONS')
        ? db.conditions.filter((c) => owned(c) && c.kind === 'CONDITION').map((c) => c.name)
        : undefined,
      medications: can('MEDICATION')
        ? db.medicationPlans.filter((p) => owned(p) && p.status === 'ACTIVE').map((p) => summarize(p, now))
        : undefined,
      appointments: can('APPOINTMENTS')
        ? recent(appointments).map((appointment) => ({ appointment, memberName: member.name }))
        : undefined,
      examinations: can('EXAMS')
        ? recent(db.examinations.filter(owned).sort((a, b) => b.examDate.localeCompare(a.examDate))).map(
            (examination) => ({
              examination,
              memberName: member.name,
              resultCount: db.examResults.filter((r) => r.examinationId === examination.id).length,
            }),
          )
        : undefined,
      prescriptions: can('MEDICATION')
        ? recent(db.prescriptions.filter(owned).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))).map(
            (prescription) => ({
              prescription,
              memberName: member.name,
              medicationCount: db.medicationPlans.filter((p) => p.prescriptionId === prescription.id).length,
            }),
          )
        : undefined,
    }
  })
}

export interface MemberHistory {
  member: PublicMember
  manage: boolean
  entries: HistoryEntry[]
  /** Categorias do histórico que o utilizador não pode ver (mostradas com cadeado). */
  hidden: SharingCategory[]
}

/** Histórico completo do membro, só com as categorias que o utilizador pode ver. */
export function getMemberHistory(familyId: string, userId: string, memberId: string, now: Date = new Date()) {
  return respond((): MemberHistory => {
    const { manage, categories } = memberAccess(familyId, userId, memberId)
    const member = db.members.find((m) => m.id === memberId && m.familyId === familyId)
    if (!member) throw new AppError('NOT_FOUND')
    const historyCategories: SharingCategory[] = ['APPOINTMENTS', 'EXAMS', 'MEDICATION', 'CONDITIONS']
    return {
      member: toPublic(member),
      manage,
      entries: historyEntries(familyId, memberId, categories, now),
      hidden: historyCategories.filter((c) => !categories.has(c)),
    }
  })
}
