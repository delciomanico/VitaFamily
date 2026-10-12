import * as api from '@/mocks/handlers/clinics'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { Clinic } from '@/types/clinic'

interface ApiClinic {
  id: string
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  type: 'PARTNER' | 'PRIVATE'
  status: 'ACTIVE' | 'ARCHIVED'
}

/** `GET /families/{id}/clinics` (API real): parceiras e privadas da família, só as ativas. */
async function apiListClinics(familyId: string): Promise<Clinic[]> {
  const list = await apiFetch<ApiClinic[]>(`/families/${familyId}/clinics?status=ACTIVE`)
  return list
    .filter((c) => c.status === 'ACTIVE')
    .map((c) => ({
      id: c.id,
      type: c.type,
      familyId: c.type === 'PRIVATE' ? familyId : undefined,
      name: c.name,
      address: c.address ?? undefined,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      status: c.status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
}

/** Clínicas parceiras e privadas da família. Com `VITE_API_URL` usa `/api/v1/families/{id}/clinics`. */
export const clinicService = {
  listClinics: hasApiBackend() ? apiListClinics : api.listClinics,
}
