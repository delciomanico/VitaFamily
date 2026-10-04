import { AppError } from '@/lib/errors'
import { db } from './db'

/*
 * Regras de acesso do backend simulado (versão simplificada de access.Policy):
 * cada utilizador vê os seus dados e os dos dependentes de quem é tutor (BR-MEM-08).
 * TODO(fase 9): partilha por categoria (SharingGrant, BR-PRV-01..04).
 */

/** Perfil do utilizador na família; fora dela → NOT_FOUND (sem enumeração). */
export function requireSelf(familyId: string, userId: string) {
  const self = db.members.find((m) => m.familyId === familyId && m.userId === userId && m.status === 'ACTIVE')
  if (!self) throw new AppError('NOT_FOUND')
  return self
}

/** Membros cujos dados de saúde o utilizador pode ver. */
export function visibleMemberIds(familyId: string, userId: string): string[] {
  const self = requireSelf(familyId, userId)
  const wards = db.guardianships
    .filter((g) => g.familyId === familyId && g.guardianId === self.id)
    .map((g) => g.dependentId)
  return [self.id, ...wards]
}

export function memberName(memberId: string): string {
  return db.members.find((m) => m.id === memberId)?.name ?? ''
}
