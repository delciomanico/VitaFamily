import * as mock from '@/mocks/handlers/admin'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { AdminUserPage, ClinicInput, ClinicPatch } from '@/types/admin'
import type { Clinic, ClinicAccount } from '@/types/clinic'

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

function apiListUsers(cursor?: string): Promise<AdminUserPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return apiFetch<AdminUserPage>(`/admin/users${query}`)
}

const apiImpl = {
  listUsers: apiListUsers,
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
}

const mockImpl = {
  listUsers: (cursor?: string) => mock.adminListUsers(cursor),
  suspendUser: (userId: string, reason: string, actorUserId: string) =>
    mock.adminSuspendUser(actorUserId, userId, reason),
  reactivateUser: (userId: string) => mock.adminReactivateUser(userId),

  listClinics: () => mock.adminListClinics(),
  createClinic: (input: ClinicInput) => mock.adminCreateClinic(input),
  updateClinic: (clinicId: string, patch: ClinicPatch) => mock.adminUpdateClinic(clinicId, patch),
  setClinicStatus: (clinicId: string, status: Clinic['status']) => mock.adminSetClinicStatus(clinicId, status),
  createOrResetClinicRootAccount: (clinicId: string, email: string) =>
    mock.adminCreateOrResetClinicRootAccount(clinicId, email),
}

/**
 * `suspendUser` recebe `actorUserId` só para o mock impedir a auto-suspensão (BR-ACC-05) sem
 * depender de sessão própria do backend simulado; a API real resolve isso pelo próprio token.
 */
export const adminService = hasApiBackend()
  ? { ...apiImpl, suspendUser: (userId: string, reason: string, _actorUserId: string) => apiImpl.suspendUser(userId, reason) }
  : mockImpl
