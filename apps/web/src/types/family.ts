import type { BloodType, Sex } from './health'
import type { SharingCategory } from './sharing'

/** Fronteira de isolamento dos dados (docs/04-domain/entities.md → Family). */
export interface Family {
  id: string
  name: string
  createdBy: string
}

export type FamilyRole = 'FAMILY_ADMIN' | 'FAMILY_MEMBER'
export type MemberStatus = 'ACTIVE' | 'BLOCKED'

/**
 * TBD: “Relação” vem da especificação do frontend e não existe no domínio
 * (o domínio modela tutela e dependentes). Só UI e mocks até decisão por change control.
 */
export const RELATIONSHIPS = [
  'SELF',
  'SPOUSE',
  'FATHER',
  'MOTHER',
  'SON',
  'DAUGHTER',
  'SIBLING',
  'GRANDPARENT',
  'OTHER',
] as const
export type Relationship = (typeof RELATIONSHIPS)[number]

/** Pessoa numa família; sujeito dos dados de saúde. */
export interface FamilyMember {
  id: string
  familyId: string
  /** Presente quando o membro tem conta. */
  userId?: string
  name: string
  birthDate: string
  /** Só membros com conta têm papel. */
  role?: FamilyRole
  isDependent: boolean
  bloodType?: BloodType
  status: MemberStatus
  /** TBD (ver Relationship). */
  relationship?: Relationship
  /** TBD (ver Sex). */
  sex?: Sex
}

/** Família do utilizador e o seu próprio perfil de membro nela. */
export interface Membership {
  family: Family
  member: FamilyMember
}

/** Dados de um membro visíveis a toda a família (C1, BR-PRV-10): sem dados de saúde. */
export interface PublicMember {
  id: string
  name: string
  birthDate: string
  relationship?: Relationship
  role?: FamilyRole
  isDependent: boolean
  hasAccount: boolean
}

/** Estado de acompanhamento na lista da família. */
export type MemberTracking =
  | { kind: 'UP_TO_DATE' }
  | { kind: 'PENDING'; count: number }
  /** Membro que não gere: só as categorias que partilha consigo. */
  | { kind: 'SHARED'; categories: SharingCategory[] }

export interface FamilyMemberCard {
  member: PublicMember
  isSelf: boolean
  /** Próprio ou dependente seu (vê e edita tudo). */
  manage: boolean
  tracking: MemberTracking
}

export interface FamilyOverview {
  family: Family
  /** O utilizador é Family Admin (adicionar e remover membros). */
  isAdmin: boolean
  members: FamilyMemberCard[]
}
