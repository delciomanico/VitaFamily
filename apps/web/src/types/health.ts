import type { FamilyMember } from './family'

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] as const
export type BloodType = (typeof BLOOD_TYPES)[number]

/**
 * TBD: “Sexo” vem da especificação do frontend e não existe no domínio
 * (docs/04-domain/entities.md). Fica só na UI e nos mocks até decisão por change control.
 */
export const SEXES = ['FEMALE', 'MALE', 'UNSPECIFIED'] as const
export type Sex = (typeof SEXES)[number]

/** Alergia — categoria C2. */
export interface Allergy {
  id: string
  familyId: string
  memberId: string
  name: string
  notes?: string
  since?: string
}

/** Condição de saúde ou histórico — categoria C3. */
export interface MedicalCondition {
  id: string
  familyId: string
  memberId: string
  name: string
  kind: 'CONDITION' | 'HISTORY'
  notes?: string
  since?: string
  until?: string
}

/** Vista agregada do perfil de saúde de um membro (não é uma entidade guardada). */
export interface HealthProfile {
  member: FamilyMember
  allergies: Allergy[]
  conditions: MedicalCondition[]
}
