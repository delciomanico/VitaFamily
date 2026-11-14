import * as mock from '@/mocks/handlers/insurerOps'
import { AppError } from '@/lib/errors'
import { hasApiBackend } from '@/lib/apiClient'
import { insuranceApiFetch } from '@/lib/insuranceApiClient'
import { asArray } from '@/lib/safe'
import { insuranceSessionStore } from '@/lib/storage'
import type {
  BeneficiaryRelationship,
  BeneficiaryStatus,
  InsurerBeneficiary,
  InsurerBeneficiaryInput,
  InsurerBeneficiaryPatch,
  InsurerClaimCode,
  InsurerCompany,
  InsurerImport,
  InsurerLinkRequest,
  InsurerPlan,
  InsurerPlanCoverage,
  InsurerPlanCoverageInput,
  InsurerPolicy,
  InsurerPolicyInput,
  InsurerProvider,
  InsurerService,
  InsurerServiceInput,
  InsurerServicePatch,
  LinkRequestStatus,
  Page,
  PartnerClinic,
  PlanStatus,
  PolicyStatus,
} from '@/types/insurerOps'

/**
 * Módulo operacional de seguradoras, Fase A (ADR-025), no portal `/insurance-portal/*`: empresas,
 * beneficiários, importações, ligações de cartão, apólices, planos, serviços e clínicas. A sessão
 * e o token são os do portal da seguradora (`insurancePortal.service`).
 *
 * Divergências conhecidas do contrato (ver relatório da Fase A):
 * - o portal não tem rota que diga se o módulo está ativo nem qual a moeda da seguradora
 *   (`Insurer.currency` só existe em `/admin/insurers`): módulo desativado deteta-se por `NOT_FOUND`
 *   em qualquer listagem e a moeda é `AOA` por omissão (BR-SEG-19);
 * - `InsuranceTokenResponse` não traz o nome da seguradora.
 */

const LIMIT = 20

type Query = Record<string, string | number | undefined>

function qs(query: Query = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** Defesa contra respostas fora do contrato: `items` ausente ⇒ lista vazia; `nextCursor` ausente ⇒ fim. */
function safePage<T>(raw: Page<T> | null | undefined): Page<T> {
  return { items: asArray(raw?.items), nextCursor: raw?.nextCursor ?? null }
}

const api = <T>(path: string, options?: { method?: string; body?: unknown }) => insuranceApiFetch<T>(path, options)

const apiImpl = {
  listCompanies: async (query?: Query & { status?: string }) =>
    safePage(await api<Page<InsurerCompany>>(`/companies${qs({ limit: LIMIT, ...query })}`)),
  createCompany: (input: { name: string; taxId: string }) => api<InsurerCompany>('/companies', { method: 'POST', body: input }),
  updateCompany: (id: string, patch: { name?: string; status?: InsurerCompany['status'] }) =>
    api<InsurerCompany>(`/companies/${id}`, { method: 'PATCH', body: patch }),

  listBeneficiaries: async (query?: Query) => safePage(await api<Page<InsurerBeneficiary>>(`/beneficiaries${qs({ limit: LIMIT, ...query })}`)),
  createBeneficiary: (input: InsurerBeneficiaryInput) => api<InsurerBeneficiary>('/beneficiaries', { method: 'POST', body: input }),
  updateBeneficiary: (id: string, patch: InsurerBeneficiaryPatch) =>
    api<InsurerBeneficiary>(`/beneficiaries/${id}`, { method: 'PATCH', body: patch }),
  setBeneficiaryStatus: (id: string, status: BeneficiaryStatus, note?: string) =>
    api<InsurerBeneficiary>(`/beneficiaries/${id}/status`, { method: 'POST', body: { status, ...(note?.trim() ? { note: note.trim() } : {}) } }),
  issueClaimCode: (id: string) => api<InsurerClaimCode>(`/beneficiaries/${id}/claim-code`, { method: 'POST' }),

  createImport: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return api<InsurerImport>('/imports', { method: 'POST', body })
  },
  commitImport: (id: string) => api<InsurerImport>(`/imports/${id}/commit`, { method: 'POST' }),
  cancelImport: (id: string) => api<void>(`/imports/${id}`, { method: 'DELETE' }),

  listLinkRequests: async (query?: Query & { status?: LinkRequestStatus }) =>
    safePage(await api<Page<InsurerLinkRequest>>(`/link-requests${qs({ limit: LIMIT, ...query })}`)),
  confirmLinkRequest: (id: string) => api<InsurerLinkRequest>(`/link-requests/${id}/confirm`, { method: 'POST' }),
  rejectLinkRequest: (id: string, note: string) =>
    api<InsurerLinkRequest>(`/link-requests/${id}/reject`, { method: 'POST', body: { note: note.trim() } }),

  listPolicies: async (query?: Query) => safePage(await api<Page<InsurerPolicy>>(`/policies${qs({ limit: LIMIT, ...query })}`)),
  createPolicy: (input: InsurerPolicyInput) => api<InsurerPolicy>('/policies', { method: 'POST', body: input }),
  setPolicyStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED', note?: string) =>
    api<InsurerPolicy>(`/policies/${id}/status`, { method: 'POST', body: { status, ...(note?.trim() ? { note: note.trim() } : {}) } }),

  listPlans: async (query?: Query & { status?: PlanStatus }) => safePage(await api<Page<InsurerPlan>>(`/plans${qs({ limit: LIMIT, ...query })}`)),
  getPlan: (id: string) => api<InsurerPlan>(`/plans/${id}`),
  createPlan: (name: string) => api<InsurerPlan>('/plans', { method: 'POST', body: { name: name.trim() } }),
  setPlanStatus: (id: string, status: 'ACTIVE' | 'ARCHIVED') =>
    api<InsurerPlan>(`/plans/${id}/status`, { method: 'POST', body: { status } }),
  newPlanVersion: (id: string) => api<InsurerPlan>(`/plans/${id}/new-version`, { method: 'POST' }),
  listPlanCoverages: async (id: string) => asArray(await api<InsurerPlanCoverage[]>(`/plans/${id}/coverages`)),
  replacePlanCoverages: async (id: string, items: InsurerPlanCoverageInput[]) =>
    asArray(await api<InsurerPlanCoverage[]>(`/plans/${id}/coverages`, { method: 'PUT', body: { items } })),

  listServices: async (query?: Query) => safePage(await api<Page<InsurerService>>(`/services${qs({ limit: LIMIT, ...query })}`)),
  createService: (input: InsurerServiceInput) => api<InsurerService>('/services', { method: 'POST', body: input }),
  updateService: (id: string, patch: InsurerServicePatch) => api<InsurerService>(`/services/${id}`, { method: 'PATCH', body: patch }),

  listPartnerClinics: async (query?: Query) => safePage(await api<Page<PartnerClinic>>(`/partner-clinics${qs({ limit: LIMIT, ...query })}`)),
  listProviders: async (query?: Query) => safePage(await api<Page<InsurerProvider>>(`/providers${qs({ limit: LIMIT, ...query })}`)),
  createProvider: (clinicId: string) => api<InsurerProvider>('/providers', { method: 'POST', body: { clinicId } }),
  setProviderStatus: (id: string, status: InsurerProvider['status']) =>
    api<InsurerProvider>(`/providers/${id}/status`, { method: 'POST', body: { status } }),
}

function accountId(): string {
  const id = insuranceSessionStore.getAccountId()
  if (!id) throw new AppError('INVALID_CREDENTIALS')
  return id
}

const cursorQuery = (query?: Query) => ({ limit: Number(query?.limit ?? LIMIT), cursor: query?.cursor as string | undefined })

/** Mock: mesmas assinaturas; `safePage` também protege contra os mocks (clones estruturados). */
const mockImpl: typeof apiImpl = {
  listCompanies: (q) => mock.listCompanies(accountId(), { ...cursorQuery(q), status: q?.status as InsurerCompany['status'] }),
  createCompany: (input) => mock.createCompany(accountId(), input),
  updateCompany: (id, patch) => mock.updateCompany(accountId(), id, patch),

  listBeneficiaries: (q) =>
    mock.listBeneficiaries(accountId(), {
      ...cursorQuery(q),
      q: q?.q as string | undefined,
      status: q?.status as BeneficiaryStatus | undefined,
      companyId: q?.companyId as string | undefined,
      holderId: q?.holderId as string | undefined,
      relationship: q?.relationship as BeneficiaryRelationship | undefined,
    }),
  createBeneficiary: (input) => mock.createBeneficiary(accountId(), input),
  updateBeneficiary: (id, patch) => mock.updateBeneficiary(accountId(), id, patch),
  setBeneficiaryStatus: (id, status, note) => mock.setBeneficiaryStatus(accountId(), id, status, note),
  issueClaimCode: (id) => mock.issueClaimCode(accountId(), id),

  createImport: async (file) => mock.createImport(accountId(), { name: file.name, text: await file.text() }),
  commitImport: (id) => mock.commitImport(accountId(), id),
  cancelImport: (id) => mock.cancelImport(accountId(), id),

  listLinkRequests: (q) => mock.listLinkRequests(accountId(), { ...cursorQuery(q), status: q?.status as LinkRequestStatus | undefined }),
  confirmLinkRequest: (id) => mock.confirmLinkRequest(accountId(), id),
  rejectLinkRequest: (id, note) => mock.rejectLinkRequest(accountId(), id, note),

  listPolicies: (q) =>
    mock.listPolicies(accountId(), {
      ...cursorQuery(q),
      q: q?.q as string | undefined,
      status: q?.status as PolicyStatus | undefined,
      holderId: q?.holderId as string | undefined,
      companyId: q?.companyId as string | undefined,
    }),
  createPolicy: (input) => mock.createPolicy(accountId(), input),
  setPolicyStatus: (id, status, note) => mock.setPolicyStatus(accountId(), id, status, note),

  listPlans: (q) => mock.listPlans(accountId(), { ...cursorQuery(q), status: q?.status as PlanStatus | undefined, name: q?.name as string | undefined }),
  getPlan: (id) => mock.getPlan(accountId(), id),
  createPlan: (name) => mock.createPlan(accountId(), { name }),
  setPlanStatus: (id, status) => mock.setPlanStatus(accountId(), id, status),
  newPlanVersion: (id) => mock.newPlanVersion(accountId(), id),
  listPlanCoverages: (id) => mock.listPlanCoverages(accountId(), id),
  replacePlanCoverages: (id, items) => mock.replacePlanCoverages(accountId(), id, items),

  listServices: (q) =>
    mock.listServices(accountId(), { ...cursorQuery(q), q: q?.q as string | undefined, status: q?.status as InsurerService['status'] | undefined }),
  createService: (input) => mock.createService(accountId(), input),
  updateService: (id, patch) => mock.updateService(accountId(), id, patch),

  listPartnerClinics: (q) => mock.listPartnerClinics(accountId(), { ...cursorQuery(q), q: q?.q as string | undefined }),
  listProviders: (q) => mock.listProviders(accountId(), cursorQuery(q)),
  createProvider: (clinicId) => mock.createProvider(accountId(), clinicId),
  setProviderStatus: (id, status) => mock.setProviderStatus(accountId(), id, status),
}

export const insurerOpsService = hasApiBackend() ? apiImpl : mockImpl
