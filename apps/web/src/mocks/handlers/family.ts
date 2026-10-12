import { AppError } from '@/lib/errors'
import type { FamilyMember, Membership, Relationship } from '@/types/family'
import { findVisibleMember, visibleMemberIds } from '../access'
import { db, newId } from '../db'
import { respond } from '../respond'

/** `InvitationPreview` (openapi.yaml): dados mínimos mostrados antes de aceitar. */
export interface InvitationPreviewResult {
  familyName: string
  invitedEmail: string
  type: 'MEMBER' | 'DEPENDENT_ACCOUNT'
  expiresAt: string
}

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

function findInvitationByToken(token: string) {
  return db.invitations.find((i) => i.code === token.trim().toUpperCase())
}

/** `POST /invitations/lookup` (PUBLIC) — usado pela tela `/invite/accept` antes de aceitar. */
export function lookupInvitationByToken(token: string) {
  return respond((): InvitationPreviewResult => {
    const invitation = findInvitationByToken(token)
    const family = invitation && db.families.find((f) => f.id === invitation.familyId)
    if (!invitation || !family) throw new AppError('INVITATION_INVALID')
    if (invitation.status === 'EXPIRED') throw new AppError('INVITATION_EXPIRED')
    if (invitation.status !== 'PENDING') throw new AppError('INVITATION_INVALID')
    return {
      familyName: family.name,
      invitedEmail: invitation.invitedEmail,
      type: invitation.type,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }
  })
}

/**
 * `POST /invitations/accept` (AUTH) — exige que o e-mail da conta coincida com o convidado
 * (BR-MEM-12/13/17), ao contrário de `joinFamily` (código de uso livre, mantido só para os
 * testes existentes que o chamam diretamente).
 */
export function acceptInvitationByToken(userId: string, token: string) {
  return respond((): Membership => {
    const user = requireUser(userId)
    const invitation = findInvitationByToken(token)
    const family = invitation && db.families.find((f) => f.id === invitation.familyId)
    if (!invitation || !family) throw new AppError('INVITATION_INVALID')
    if (invitation.status === 'EXPIRED') throw new AppError('INVITATION_EXPIRED')
    if (invitation.status !== 'PENDING') throw new AppError('INVITATION_INVALID')
    if (user.email.trim().toLowerCase() !== invitation.invitedEmail.trim().toLowerCase()) {
      throw new AppError('INVITATION_EMAIL_MISMATCH')
    }

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

/** BR-FAM-02: a família nunca pode ficar sem Family Admin. */
function assertNotLastAdmin(familyId: string, target: FamilyMember) {
  if (target.role !== 'FAMILY_ADMIN') return
  const admins = db.members.filter((m) => m.familyId === familyId && m.status === 'ACTIVE' && m.role === 'FAMILY_ADMIN')
  if (admins.length <= 1) throw new AppError('LAST_ADMIN')
}

/** BR-MEM-07/P8: um dependente nunca pode ficar sem tutor. */
function assertNotLastGuardian(familyId: string, guardianId: string) {
  const dependents = db.guardianships.filter((g) => g.familyId === familyId && g.guardianId === guardianId)
  for (const dependency of dependents) {
    const guardians = db.guardianships.filter((g) => g.familyId === familyId && g.dependentId === dependency.dependentId)
    if (guardians.length <= 1) throw new AppError('LAST_GUARDIAN')
  }
}

/**
 * Remove membro (UC-MEM-08, só Admin). Um adulto com conta recebe o pacote de dados antes de ser
 * apagado (BR-MEM-16) — o mock não gera o .zip real, só simula a mesma ordem de operações.
 */
export function removeMember(familyId: string, actorUserId: string, memberId: string) {
  return respond(() => {
    requireAdmin(familyId, actorUserId)
    const index = db.members.findIndex((m) => m.id === memberId && m.familyId === familyId)
    const target = db.members[index]
    if (!target) throw new AppError('NOT_FOUND')
    if (target.userId === actorUserId) throw new AppError('FORBIDDEN')
    assertNotLastAdmin(familyId, target)
    assertNotLastGuardian(familyId, target.id)
    db.members.splice(index, 1)
    db.guardianships = db.guardianships.filter((g) => g.dependentId !== memberId && g.guardianId !== memberId)
    return undefined
  })
}

export type LeaveFamilyDataChoice = 'TAKE' | 'DELETE'

/**
 * Sair da família (UC-MEM-09, R4): o próprio adulto, com conta, escolhe levar ou apagar os dados.
 * Dependentes e menores não saem sozinhos (precisam de ser removidos pelo Admin/tutor).
 */
export function leaveFamily(familyId: string, actorUserId: string, _dataChoice: LeaveFamilyDataChoice) {
  return respond(() => {
    const index = db.members.findIndex((m) => m.familyId === familyId && m.userId === actorUserId && m.status === 'ACTIVE')
    const self = db.members[index]
    if (!self) throw new AppError('NOT_FOUND')
    assertNotLastAdmin(familyId, self)
    assertNotLastGuardian(familyId, self.id)
    db.members.splice(index, 1)
    db.guardianships = db.guardianships.filter((g) => g.dependentId !== self.id && g.guardianId !== self.id)
    return undefined
  })
}
