import type { UserStatus } from './user'

/** `AdminUser` (openapi.yaml): D4/R10 — nunca inclui dados de saúde, só o essencial da conta. */
export interface AdminUser {
  id: string
  email: string
  name: string
  status: UserStatus
  createdAt: string
}

/** `AdminUserDetail` (openapi.yaml): detalhe operacional; `familiesCount` é só um número (R10). */
export interface AdminUserDetail extends AdminUser {
  platformRole: 'NONE' | 'PLATFORM_ADMIN'
  emailVerifiedAt: string | null
  suspendedAt: string | null
  suspensionReason: string | null
  familiesCount: number
  activeSessionsCount: number
  lastSessionUsedAt: string | null
}

/** `AdminClinicAccount` (openapi.yaml): conta do portal de uma clínica, com último login. */
export interface AdminClinicAccount {
  id: string
  clinicId: string
  email: string
  role: 'CLINIC_ADMIN' | 'CLINIC_MANAGER'
  status: 'ACTIVE' | 'SUSPENDED'
  createdAt: string
  lastLoginAt: string | null
  suspendedAt: string | null
}

/** Pesquisa `q` aceite pela API: 2 ou mais caracteres. */
export const ADMIN_SEARCH_MIN = 2

/** `GET /admin/users` (openapi.yaml): página com cursor para "carregar mais". */
export interface AdminUserPage {
  items: AdminUser[]
  nextCursor: string | null
}

/** `ClinicInput` (openapi.yaml): criação de clínica parceira pelo Platform Admin. */
export interface ClinicInput {
  name: string
  address?: string
  phone?: string
  email?: string
}

/** `ClinicPatch` (openapi.yaml): todos os campos opcionais. */
export type ClinicPatch = Partial<ClinicInput>
