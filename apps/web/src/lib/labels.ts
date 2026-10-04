import type { SelectOption } from '@/components/ui/Select'
import { RELATIONSHIPS, type FamilyRole, type Relationship } from '@/types/family'
import { BLOOD_TYPES, SEXES, type BloodType, type Sex } from '@/types/health'

/** Textos em pt-PT para valores do domínio. */

export const relationshipLabels: Record<Relationship, string> = {
  SELF: 'Eu',
  SPOUSE: 'Cônjuge',
  FATHER: 'Pai',
  MOTHER: 'Mãe',
  SON: 'Filho',
  DAUGHTER: 'Filha',
  SIBLING: 'Irmão/Irmã',
  GRANDPARENT: 'Avô/Avó',
  OTHER: 'Outro',
}

export const sexLabels: Record<Sex, string> = {
  FEMALE: 'Feminino',
  MALE: 'Masculino',
  UNSPECIFIED: 'Prefiro não indicar',
}

export const roleLabels: Record<FamilyRole, string> = {
  FAMILY_ADMIN: 'Administrador',
  FAMILY_MEMBER: 'Membro',
}

export function bloodTypeLabel(value: BloodType): string {
  return value === 'UNKNOWN' ? 'Não sei' : value
}

export const relationshipOptions: SelectOption[] = RELATIONSHIPS.filter((r) => r !== 'SELF').map((value) => ({
  value,
  label: relationshipLabels[value],
}))

export const sexOptions: SelectOption[] = SEXES.map((value) => ({ value, label: sexLabels[value] }))

export const bloodTypeOptions: SelectOption[] = BLOOD_TYPES.map((value) => ({
  value,
  label: bloodTypeLabel(value),
}))
