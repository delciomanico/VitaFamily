import type { Family, FamilyMember } from '@/types/family'

/** Família demo. Todos os dados são fictícios. */
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
    isDependent: false,
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
    isDependent: false,
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
]

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
