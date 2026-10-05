import { AppError } from '@/lib/errors'
import type { FamilyMember, Membership, Relationship } from '@/types/family'
import { findVisibleMember, visibleMemberIds } from '../access'
import { db, newId } from '../db'
import { respond } from '../respond'

export interface NewMemberInput {
  name: string
  birthDate: string
  relationship: Relationship
}

function findMembership(userId: string): Membership | null {
  // TODO(UC-FAM-02): um utilizador pode pertencer a várias famílias; o MVP usa a primeira.
  const member = db.members.find((m) => m.userId === userId && m.status === 'ACTIVE')
  const family = member && db.families.find((f) => f.id === member.familyId)
  return member && family ? { family, member } : null
}

function requireUser(userId: string) {
  const user = db.users.find((u) => u.id === userId)
  if (!user) throw new AppError('NOT_FOUND')
  return user
}

/** Garante que o ator é Admin da família (isolamento + permissão). */
function requireAdmin(familyId: string, actorUserId: string) {
  const actor = db.members.find((m) => m.familyId === familyId && m.userId === actorUserId)
  if (!actor) throw new AppError('NOT_FOUND')
  if (actor.role !== 'FAMILY_ADMIN') throw new AppError('FORBIDDEN')
  return actor
}

export function getMembership(userId: string) {
  return respond(() => findMembership(userId))
}

/** UC-FAM-01: cria a família e o membro do próprio utilizador como Admin. */
export function createFamily(userId: string, name: string) {
  return respond((): Membership => {
    const user = requireUser(userId)
    const family = { id: newId('fam'), name: name.trim(), createdBy: userId }
    const member: FamilyMember = {
      id: newId('mem'),
      familyId: family.id,
      userId,
      name: user.name,
      birthDate: user.birthDate,
      role: 'FAMILY_ADMIN',
      isDependent: false,
      status: 'ACTIVE',
      relationship: 'SELF',
    }
    db.families.push(family)
    db.members.push(member)
    return { family, member }
  })
}

/** Entrar numa família com um código de convite (convite de uso único). */
export function joinFamily(userId: string, code: string) {
  return respond((): Membership => {
    const user = requireUser(userId)
    const invitation = db.invitations.find((i) => i.code === code.trim().toUpperCase() && i.status === 'PENDING')
    const family = invitation && db.families.find((f) => f.id === invitation.familyId)
    if (!invitation || !family) throw new AppError('INVITATION_INVALID')

    const member: FamilyMember = {
      id: newId('mem'),
      familyId: family.id,
      userId,
      name: user.name,
      birthDate: user.birthDate,
      role: 'FAMILY_MEMBER',
      isDependent: false,
      status: 'ACTIVE',
      relationship: 'SELF',
    }
    invitation.status = 'ACCEPTED'
    db.members.push(member)
    return { family, member }
  })
}

export function listMembers(familyId: string) {
  return respond(() => db.members.filter((m) => m.familyId === familyId && m.status === 'ACTIVE'))
}

/**
 * Membros cujos dados de saúde o utilizador gere: o próprio e os dependentes de quem é tutor
 * (escolha de “Para quem” ao registar receitas ou exames).
 */
export function listManagedMembers(familyId: string, userId: string) {
  return respond((): FamilyMember[] =>
    visibleMemberIds(familyId, userId).map((id) => findVisibleMember(familyId, userId, id)),
  )
}

/** Adiciona um perfil sem conta (só Admin). */
export function addMember(familyId: string, actorUserId: string, input: NewMemberInput) {
  return respond((): FamilyMember => {
    const actor = requireAdmin(familyId, actorUserId)
    // Perfil sem conta é sempre dependente com tutor (BR-MEM-03/04); quem o cria fica tutor principal.
    const member: FamilyMember = {
      id: newId('mem'),
      familyId,
      name: input.name.trim(),
      birthDate: input.birthDate,
      isDependent: true,
      status: 'ACTIVE',
      relationship: input.relationship,
    }
    db.members.push(member)
    db.guardianships.push({ familyId, dependentId: member.id, guardianId: actor.id, isPrimary: true })
    return member
  })
}

/** Alterar o nome da família (UC-FAM-03, só Admin). */
export function updateFamily(familyId: string, actorUserId: string, name: string) {
  return respond(() => {
    requireAdmin(familyId, actorUserId)
    const family = db.families.find((f) => f.id === familyId)
    if (!family) throw new AppError('NOT_FOUND')
    if (name.trim().length < 2) throw new AppError('VALIDATION_ERROR')
    family.name = name.trim()
    return family
  })
}

export function removeMember(familyId: string, actorUserId: string, memberId: string) {
  return respond(() => {
    requireAdmin(familyId, actorUserId)
    const index = db.members.findIndex((m) => m.id === memberId && m.familyId === familyId)
    const target = db.members[index]
    if (!target) throw new AppError('NOT_FOUND')
    if (target.userId === actorUserId) throw new AppError('FORBIDDEN')
    // TODO(BR-MEM-16, R4): remover um adulto com conta exige o pacote de dados; por agora só dependentes sem conta.
    if (target.userId) throw new AppError('CONFLICT')
    db.members.splice(index, 1)
    db.guardianships = db.guardianships.filter((g) => g.dependentId !== memberId && g.guardianId !== memberId)
    return undefined
  })
}
