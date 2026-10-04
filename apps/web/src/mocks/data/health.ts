import type { Allergy, MedicalCondition } from '@/types/health'

/** Dados de saúde fictícios da Família Monarca. */
export const allergies: Allergy[] = [
  { id: 'alg_1', familyId: 'fam_monarca', memberId: 'mem_monarca', name: 'Pólen' },
  { id: 'alg_2', familyId: 'fam_monarca', memberId: 'mem_pedro', name: 'Amendoim' },
  { id: 'alg_3', familyId: 'fam_monarca', memberId: 'mem_joao', name: 'Penicilina' },
  { id: 'alg_4', familyId: 'fam_monarca', memberId: 'mem_ana', name: 'Ácaros' },
]

export const conditions: MedicalCondition[] = [
  { id: 'cnd_1', familyId: 'fam_monarca', memberId: 'mem_joao', name: 'Diabetes tipo 2', kind: 'CONDITION' },
  { id: 'cnd_2', familyId: 'fam_monarca', memberId: 'mem_joao', name: 'Hipertensão arterial', kind: 'CONDITION' },
  { id: 'cnd_3', familyId: 'fam_monarca', memberId: 'mem_monarca', name: 'Asma', kind: 'CONDITION' },
  { id: 'cnd_5', familyId: 'fam_monarca', memberId: 'mem_ana', name: 'Enxaqueca', kind: 'CONDITION' },
  {
    id: 'cnd_4',
    familyId: 'fam_monarca',
    memberId: 'mem_monarca',
    name: 'Apendicectomia',
    kind: 'HISTORY',
    notes: 'Cirurgia sem complicações.',
    since: '2012-06-14',
  },
]
