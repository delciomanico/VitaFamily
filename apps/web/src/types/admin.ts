import type { UserStatus } from './user'

/** `AdminUser` (openapi.yaml): D4/R10 — nunca inclui dados de saúde, só o essencial da conta. */
export interface AdminUser {
  id: string
  email: string
  status: UserStatus
  createdAt: string
}

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
