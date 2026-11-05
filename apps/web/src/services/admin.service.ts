import * as mock from '@/mocks/handlers/admin'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { AdminClinicAccount, AdminUserDetail, AdminUserPage, ClinicInput, ClinicPatch } from '@/types/admin'
import type { Clinic, ClinicAccount } from '@/types/clinic'
import type { InsuranceAccount, Insurer, InsurerInput, InsurerPatch } from '@/types/insurance'

/**
 * Área do Platform Admin (`/admin/*`, openapi.yaml tag "Admin"). Usa a mesma sessão de `User`
 * que a app de família (`apiClient`/`authService`) — a autorização vem do `platformRole` no
 * token, não de um login próprio como o do portal da clínica (ADR-020 só se aplica a clínicas).
 */

/** `Clinic` real (openapi.yaml): `address`/`phone`/`email` vêm `null`, não ausentes. */
interface ApiClinic {
  id: string
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  type: Clinic['type']
  status: Clinic['status']
}

const toClinic = (clinic: ApiClinic): Clinic => ({
  id: clinic.id,
  name: clinic.name,
  address: clinic.address ?? undefined,
  phone: clinic.phone ?? undefined,
  email: clinic.email ?? undefined,
  type: clinic.type,
  status: clinic.status,
})

function apiListUsers(cursor?: string, q?: string): Promise<AdminUserPage> {
  const params = new URLSearchParams()
  if (cursor) params.set('cursor', cursor)
  if (q?.trim()) params.set('q', q.trim())
  const query = params.toString()
  return apiFetch<AdminUserPage>(`/admin/users${query ? `?${query}` : ''}`)
}

const apiImpl = {
  listUsers: apiListUsers,
  getUser: (userId: string) => apiFetch<AdminUserDetail>(`/admin/users/${userId}`),
  resetUserAccess: (userId: string, _actorUserId: string) =>
    apiFetch<void>(`/admin/users/${userId}/reset-access`, { method: 'POST' }),
  listClinicAccounts: (clinicId: string) => apiFetch<AdminClinicAccount[]>(`/admin/clinics/${clinicId}/accounts`),
  suspendClinicAccount: (clinicId: string, accountId: string, reason: string) =>
    apiFetch<void>(`/admin/clinics/${clinicId}/accounts/${accountId}/suspend`, {
      method: 'POST',
      body: { reason: reason.trim() },
    }),
  reactivateClinicAccount: (clinicId: string, accountId: string) =>
    apiFetch<void>(`/admin/clinics/${clinicId}/accounts/${accountId}/reactivate`, { method: 'POST' }),
  suspendUser: (userId: string, reason: string) =>
    apiFetch<void>(`/admin/users/${userId}/suspend`, { method: 'POST', body: { reason: reason.trim() } }),
  reactivateUser: (userId: string) => apiFetch<void>(`/admin/users/${userId}/reactivate`, { method: 'POST' }),

  async listClinics(): Promise<Clinic[]> {
    return (await apiFetch<ApiClinic[]>('/admin/clinics')).map(toClinic)
  },
  async createClinic(input: ClinicInput): Promise<Clinic> {
    return toClinic(
      await apiFetch<ApiClinic>('/admin/clinics', {
        method: 'POST',
        body: {
          name: input.name.trim(),
          address: input.address?.trim() || null,
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || null,
        },
      }),
    )
  },
  async updateClinic(clinicId: string, patch: ClinicPatch): Promise<Clinic> {
    return toClinic(
      await apiFetch<ApiClinic>(`/admin/clinics/${clinicId}`, {
        method: 'PATCH',
        body: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.address !== undefined ? { address: patch.address?.trim() || null } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone?.trim() || null } : {}),
          ...(patch.email !== undefined ? { email: patch.email?.trim() || null } : {}),
        },
      }),
    )
  },
  async setClinicStatus(clinicId: string, status: Clinic['status']): Promise<Clinic> {
    return toClinic(await apiFetch<ApiClinic>(`/admin/clinics/${clinicId}/status`, { method: 'PUT', body: { status } }))
  },
  createOrResetClinicRootAccount: (clinicId: string, email: string) =>
    apiFetch<ClinicAccount>(`/admin/clinics/${clinicId}/root-account`, {
      method: 'POST',
      body: { email: email.trim().toLowerCase() },
    }),

  listInsurers: () => apiFetch<Insurer[]>('/admin/insurers'),
  createInsurer: (input: InsurerInput) =>
    apiFetch<Insurer>('/admin/insurers', {
      method: 'POST',
      body: { name: input.name.trim(), taxId: input.taxId.trim() },
    }),
  updateInsurer: (insurerId: string, patch: InsurerPatch) =>
    apiFetch<Insurer>(`/admin/insurers/${insurerId}`, {
      method: 'PATCH',
      body: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.taxId !== undefined ? { taxId: patch.taxId.trim() } : {}),
      },
    }),
  setInsurerStatus: (insurerId: string, status: Insurer['status']) =>
    apiFetch<Insurer>(`/admin/insurers/${insurerId}/status`, { method: 'PUT', body: { status } }),
  createOrResetInsurerRootAccount: (insurerId: string, email: string) =>
    apiFetch<InsuranceAccount>(`/admin/insurers/${insurerId}/root-account`, {
      method: 'POST',
      body: { email: email.trim().toLowerCase() },
    }),
}

const mockImpl = {
  listUsers: (cursor?: string, q?: string) => mock.adminListUsers(cursor, q),
  getUser: (userId: string) => mock.adminGetUser(userId),
  resetUserAccess: (userId: string, actorUserId: string) => mock.adminResetUserAccess(actorUserId, userId),
  listClinicAccounts: (clinicId: string) => mock.adminListClinicAccounts(clinicId),
  suspendClinicAccount: (clinicId: string, accountId: string, reason: string) =>
    mock.adminSuspendClinicAccount(clinicId, accountId, reason),
  reactivateClinicAccount: (clinicId: string, accountId: string) =>
    mock.adminReactivateClinicAccount(clinicId, accountId),
  suspendUser: (userId: string, reason: string, actorUserId: string) =>
    mock.adminSuspendUser(actorUserId, userId, reason),
  reactivateUser: (userId: string) => mock.adminReactivateUser(userId),

  listClinics: () => mock.adminListClinics(),
  createClinic: (input: ClinicInput) => mock.adminCreateClinic(input),
  updateClinic: (clinicId: string, patch: ClinicPatch) => mock.adminUpdateClinic(clinicId, patch),
  setClinicStatus: (clinicId: string, status: Clinic['status']) => mock.adminSetClinicStatus(clinicId, status),
  createOrResetClinicRootAccount: (clinicId: string, email: string) =>
    mock.adminCreateOrResetClinicRootAccount(clinicId, email),

  listInsurers: () => mock.adminListInsurers(),
  createInsurer: (input: InsurerInput) => mock.adminCreateInsurer(input),
  updateInsurer: (insurerId: string, patch: InsurerPatch) => mock.adminUpdateInsurer(insurerId, patch),
  setInsurerStatus: (insurerId: string, status: Insurer['status']) => mock.adminSetInsurerStatus(insurerId, status),
  createOrResetInsurerRootAccount: (insurerId: string, email: string) =>
    mock.adminCreateOrResetInsurerRootAccount(insurerId, email),
}

/**
 * `suspendUser` recebe `actorUserId` só para o mock impedir a auto-suspensão (BR-ACC-05) sem
 * depender de sessão própria do backend simulado; a API real resolve isso pelo próprio token.
 */
export const adminService = hasApiBackend()
  ? { ...apiImpl, suspendUser: (userId: string, reason: string, _actorUserId: string) => apiImpl.suspendUser(userId, reason) }
  : mockImpl
