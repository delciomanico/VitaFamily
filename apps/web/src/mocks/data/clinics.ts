import type { Clinic } from '@/types/clinic'

/** Clínicas fictícias. */
export const clinics: Clinic[] = [
  { id: 'cln_horizonte', type: 'PARTNER', name: 'Clínica Horizonte', status: 'ACTIVE' },
  { id: 'cln_vidaplena', type: 'PARTNER', name: 'Laboratório Vida Plena', status: 'ACTIVE' },
  { id: 'cln_bairro', type: 'PRIVATE', familyId: 'fam_monarca', name: 'Centro de Saúde do Bairro', status: 'ACTIVE' },
]
