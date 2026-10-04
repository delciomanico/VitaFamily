import type { Clinic } from '@/types/clinic'
import { db } from '../db'
import { respond } from '../respond'

/** Clínicas ativas que a família pode escolher: parceiras (globais) e privadas da família (BR-CLN-01). */
export function visibleClinics(familyId: string): Clinic[] {
  return db.clinics
    .filter((c) => c.status === 'ACTIVE' && (c.type === 'PARTNER' || c.familyId === familyId))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
}

/** UC-CLN-02. */
export function listClinics(familyId: string) {
  return respond(() => visibleClinics(familyId))
}
