import * as mock from '@/mocks/handlers/clinicInsurers'
import { AppError } from '@/lib/errors'
import { hasApiBackend } from '@/lib/apiClient'
import { clinicApiFetch } from '@/lib/clinicApiClient'
import { asArray } from '@/lib/safe'
import { clinicSessionStore } from '@/lib/storage'
import type {
  ClinicInsurer,
  ClinicInsurerService,
  InsurerEligibilityRequest,
  InsurerEligibilityResult,
  Page,
} from '@/types/insurerOps'

/**
 * Validação de beneficiário no portal da clínica (`/clinic-portal/insurers*`, UC-SEG-05, Fase A).
 * Só CLINIC_ADMIN/CLINIC_MANAGER; o servidor responde 404 quando a clínica não está ligada à seguradora.
 */
const SERVICES_LIMIT = 25

const apiImpl = {
  listInsurers: async () => asArray(await clinicApiFetch<ClinicInsurer[]>('/insurers')),
  checkEligibility: (insurerId: string, request: InsurerEligibilityRequest) =>
    clinicApiFetch<InsurerEligibilityResult>(`/insurers/${insurerId}/eligibility`, { method: 'POST', body: request }),
  listServices: async (insurerId: string, query: { q?: string; cursor?: string } = {}): Promise<Page<ClinicInsurerService>> => {
    const params = new URLSearchParams({ limit: String(SERVICES_LIMIT) })
    if (query.q?.trim()) params.set('q', query.q.trim())
    if (query.cursor) params.set('cursor', query.cursor)
    const page = await clinicApiFetch<Page<ClinicInsurerService>>(`/insurers/${insurerId}/services?${params}`)
    return { items: asArray(page?.items), nextCursor: page?.nextCursor ?? null }
  },
}

function accountId(): string {
  const id = clinicSessionStore.getAccountId()
  if (!id) throw new AppError('INVALID_CREDENTIALS')
  return id
}

const mockImpl: typeof apiImpl = {
  listInsurers: () => mock.listClinicInsurers(accountId()),
  checkEligibility: (insurerId, request) => mock.checkEligibility(accountId(), insurerId, request),
  listServices: (insurerId, query = {}) => mock.listClinicInsurerServices(accountId(), insurerId, { ...query, limit: SERVICES_LIMIT }),
}

export const clinicInsurersService = hasApiBackend() ? apiImpl : mockImpl
