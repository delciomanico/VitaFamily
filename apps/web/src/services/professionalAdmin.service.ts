import * as mock from '@/mocks/handlers/professionalAdmin'
import { apiFetch, apiFetchBlob, hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined } from '@/lib/professionalApiClient'
import type {
  AdminProfessionalDetail,
  AdminProfessionalFilters,
  AdminProfessionalPage,
  AdminSpecialty,
  ProfessionalDecisionInput,
  SpecialtyInput,
  SpecialtyPatch,
} from '@/types/professional'

/**
 * Validação de profissionais e catálogo de especialidades (`/admin/professionals*`, `/admin/specialties*`,
 * MK1). Mesma sessão de `User` com `platformRole` da área `/admin`. Com `VITE_API_URL` usa a API real
 * (sessão de `User`, `apiClient`); sem ele, o backend simulado. O admin nunca lê `paymentInstructions`, ofertas, horários nem dados de saúde.
 */
const mockImpl = {
  list: (filters?: AdminProfessionalFilters): Promise<AdminProfessionalPage> => mock.adminListProfessionals(filters),
  get: (professionalId: string): Promise<AdminProfessionalDetail> => mock.adminGetProfessional(professionalId),
  decide: (professionalId: string, input: ProfessionalDecisionInput): Promise<AdminProfessionalDetail> =>
    mock.adminDecideProfessional(professionalId, input),
  downloadCredential: (professionalId: string, credentialId: string): Promise<Blob> =>
    mock.adminDownloadProfessionalCredential(professionalId, credentialId),
  listSpecialties: (): Promise<AdminSpecialty[]> => mock.adminListSpecialties(),
  createSpecialty: (input: SpecialtyInput): Promise<AdminSpecialty> => mock.adminCreateSpecialty(input),
  updateSpecialty: (specialtyId: string, patch: SpecialtyPatch): Promise<AdminSpecialty> => mock.adminUpdateSpecialty(specialtyId, patch),
}

const api = <T>(path: string, options?: { method?: string; body?: unknown }) =>
  apiFetch<unknown>(`/admin${path}`, options).then((data) => nullsToUndefined<T>(data))

const apiImpl: typeof mockImpl = {
  list(filters) {
    const search = new URLSearchParams()
    if (filters?.status) search.set('status', filters.status)
    if (filters?.category) search.set('category', filters.category)
    if (filters?.q) search.set('q', filters.q)
    if (filters?.cursor) search.set('cursor', filters.cursor)
    const text = search.toString()
    return api<AdminProfessionalPage>(`/professionals${text ? `?${text}` : ''}`).then((page) => ({
      items: page.items,
      nextCursor: page.nextCursor ?? null,
    }))
  },
  get: (professionalId) => api<AdminProfessionalDetail>(`/professionals/${encodeURIComponent(professionalId)}`),
  decide: (professionalId, input) =>
    api<AdminProfessionalDetail>(`/professionals/${encodeURIComponent(professionalId)}/decisions`, { method: 'POST', body: input }),
  downloadCredential: (professionalId, credentialId) =>
    apiFetchBlob(`/admin/professionals/${encodeURIComponent(professionalId)}/credentials/${encodeURIComponent(credentialId)}/file`),
  listSpecialties: () => api<AdminSpecialty[]>('/specialties'),
  createSpecialty: (input) => api<AdminSpecialty>('/specialties', { method: 'POST', body: input }),
  updateSpecialty: (specialtyId, patch) => api<AdminSpecialty>(`/specialties/${encodeURIComponent(specialtyId)}`, { method: 'PATCH', body: patch }),
}

export const professionalAdminService = hasApiBackend() ? apiImpl : mockImpl
