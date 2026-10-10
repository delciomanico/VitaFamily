import { AppError } from '@/lib/errors'
import type { SharedWithMeItem, SharingRule, SharingSettings } from '@/types/settings'
import { SHARING_CATEGORIES } from '@/types/sharing'
import { memberAccess, requireSelf, visibleMemberIds } from '../access'
import { db } from '../db'
import { respond } from '../respond'
import { toPublic } from './members'

/** Só o titular (o próprio) ou o tutor (pelo dependente) define a partilha (BR-PRV-02). */
function requireOwner(familyId: string, userId: string, memberId: string) {
  const { manage } = memberAccess(familyId, userId, memberId)
  if (!manage) throw new AppError('FORBIDDEN')
  return db.members.find((m) => m.id === memberId)!
}

/**
 * Quem pode receber a partilha: membros ativos com conta (só esses entram na app),
 * exceto o próprio e os seus tutores, que já veem tudo (BR-MEM-08).
 */
function possibleGrantees(familyId: string, memberId: string) {
  const guardians = new Set(db.guardianships.filter((g) => g.dependentId === memberId).map((g) => g.guardianId))
  return db.members.filter(
    (m) => m.familyId === familyId && m.status === 'ACTIVE' && m.userId && m.id !== memberId && !guardians.has(m.id),
  )
}

function settingsOf(familyId: string, memberId: string): SharingSettings {
  const member = db.members.find((m) => m.id === memberId)!
  return {
    member: toPublic(member),
    grants: db.sharingGrants
      .filter((g) => g.familyId === familyId && g.ownerMemberId === memberId)
      .map(({ category, granteeMemberId }) => (granteeMemberId ? { category, granteeMemberId } : { category })),
    others: possibleGrantees(familyId, memberId).map(toPublic),
  }
}

/** Partilha de um membro por categoria (UC-PRV-01). */
export function getSharing(familyId: string, userId: string, memberId: string) {
  return respond((): SharingSettings => {
    requireOwner(familyId, userId, memberId)
    return settingsOf(familyId, memberId)
  })
}

/**
 * Define a partilha, substituindo a anterior (só leitura, efeito imediato; BR-PRV-01..04).
 * Uma categoria partilhada com toda a família dispensa as concessões a pessoas dessa categoria.
 */
export function putSharing(familyId: string, userId: string, memberId: string, grants: SharingRule[]) {
  return respond((): SharingSettings => {
    requireOwner(familyId, userId, memberId)
    const grantees = new Set(possibleGrantees(familyId, memberId).map((m) => m.id))
    const valid = (rule: SharingRule) =>
      SHARING_CATEGORIES.includes(rule.category) &&
      (rule.granteeMemberId === undefined || grantees.has(rule.granteeMemberId))
    if (!grants.every(valid)) throw new AppError('VALIDATION_ERROR')

    const toAll = new Set(grants.filter((g) => !g.granteeMemberId).map((g) => g.category))
    const kept = new Map<string, SharingRule>()
    for (const rule of grants) {
      if (rule.granteeMemberId && toAll.has(rule.category)) continue
      kept.set(`${rule.category}:${rule.granteeMemberId ?? '*'}`, rule)
    }
    db.sharingGrants = [
      ...db.sharingGrants.filter((g) => !(g.familyId === familyId && g.ownerMemberId === memberId)),
      ...[...kept.values()].map((rule) => ({ familyId, ownerMemberId: memberId, ...rule, grantedBy: userId })),
    ]
    return settingsOf(familyId, memberId)
  })
}

/** O que os outros membros partilham comigo (UC-PRV-02); dos dependentes já vê tudo. */
export function sharedWithMe(familyId: string, userId: string) {
  return respond((): SharedWithMeItem[] => {
    requireSelf(familyId, userId)
    const managed = new Set(visibleMemberIds(familyId, userId))
    return db.members
      .filter((m) => m.familyId === familyId && m.status === 'ACTIVE' && !managed.has(m.id))
      .map((m) => ({
        memberId: m.id,
        memberName: m.name,
        categories: SHARING_CATEGORIES.filter((c) => memberAccess(familyId, userId, m.id).categories.has(c)),
      }))
      .filter((item) => item.categories.length > 0)
  })
}
