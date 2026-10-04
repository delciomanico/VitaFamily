import type { Family, FamilyMember } from '@/types/family'
import type { SharingGrant } from '@/types/sharing'

/*
 * Família demo. Todos os dados são fictícios.
 * Perfis adultos sem conta só existem como dependentes com tutor (BR-MEM-04),
 * por isso Maria e João são dependentes de Monarca. Ana é adulta com conta: os dados dela só se
 * veem nas categorias que partilha (BR-PRV-01).
 */
export const families: Family[] = [{ id: 'fam_monarca', name: 'Família Monarca', createdBy: 'usr_monarca' }]

export const members: FamilyMember[] = [
  {
    id: 'mem_monarca',
    familyId: 'fam_monarca',
    userId: 'usr_monarca',
    name: 'Monarca Lopes',
    birthDate: '1985-03-12',
    role: 'FAMILY_ADMIN',
    isDependent: false,
    bloodType: 'O+',
    status: 'ACTIVE',
    relationship: 'SELF',
  },
  {
    id: 'mem_maria',
    familyId: 'fam_monarca',
    name: 'Maria Lopes',
    birthDate: '1987-05-20',
    isDependent: true,
    bloodType: 'A+',
    status: 'ACTIVE',
    relationship: 'SPOUSE',
    sex: 'FEMALE',
  },
  {
    id: 'mem_joao',
    familyId: 'fam_monarca',
    name: 'João Lopes',
    birthDate: '1958-09-02',
    isDependent: true,
    bloodType: 'B+',
    status: 'ACTIVE',
    relationship: 'FATHER',
    sex: 'MALE',
  },
  {
    id: 'mem_pedro',
    familyId: 'fam_monarca',
    name: 'Pedro Lopes',
    birthDate: '2017-02-14',
    isDependent: true,
    bloodType: 'O+',
    status: 'ACTIVE',
    relationship: 'SON',
    sex: 'MALE',
  },
  {
    id: 'mem_ana',
    familyId: 'fam_monarca',
    userId: 'usr_ana',
    name: 'Ana Lopes',
    birthDate: '1992-11-08',
    role: 'FAMILY_MEMBER',
    isDependent: false,
    bloodType: 'AB+',
    status: 'ACTIVE',
    relationship: 'SIBLING',
    sex: 'FEMALE',
  },
]

/** Ana partilha as consultas com toda a família e as alergias só com Monarca (o resto é privado). */
export const sharingGrants: SharingGrant[] = [
  { familyId: 'fam_monarca', ownerMemberId: 'mem_ana', category: 'APPOINTMENTS', grantedBy: 'usr_ana' },
  {
    familyId: 'fam_monarca',
    ownerMemberId: 'mem_ana',
    granteeMemberId: 'mem_monarca',
    category: 'ALLERGIES',
    grantedBy: 'usr_ana',
  },
]

/** Tutela tutor ↔ dependente (Guardianship). */
export interface MockGuardianship {
  familyId: string
  dependentId: string
  guardianId: string
  isPrimary: boolean
}

export const guardianships: MockGuardianship[] = ['mem_maria', 'mem_joao', 'mem_pedro'].map((dependentId) => ({
  familyId: 'fam_monarca',
  dependentId,
  guardianId: 'mem_monarca',
  isPrimary: true,
}))

export interface MockInvitation {
  code: string
  familyId: string
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
}

/** Convite de demonstração para “Entrar numa família”. */
export const DEMO_INVITATION_CODE = 'MONARCA26'

export const invitations: MockInvitation[] = [
  { code: DEMO_INVITATION_CODE, familyId: 'fam_monarca', status: 'PENDING' },
]
