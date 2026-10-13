import type { AdminUser, ClinicInput, ClinicPatch } from '@/types/admin'
import type { Clinic, ClinicAccount } from '@/types/clinic'
import { AppError } from '@/lib/errors'
import { DEMO_PASSWORD, type MockUserRecord } from '../data/users'
import { db, newId } from '../db'
import { respond } from '../respond'

/** O mock não guarda `createdAt` por utilizador (só a API real, D4/R10): usa a data atual como
 * aproximação só para a UI ter algo a mostrar. */
function toAdminUser({ id, email, status }: MockUserRecord): AdminUser {
  return { id, email, status, createdAt: new Date().toISOString() }
}

/** `GET /admin/users` (PLATFORM_ADMIN). */
export function adminListUsers() {
  return respond(() => db.users.map((u) => toAdminUser(u)).sort((a, b) => a.email.localeCompare(b.email, 'pt-PT')))
}

/** `POST /admin/users/{id}/suspend` (BR-ACC-05): nunca a própria conta. */
export function adminSuspendUser(actorUserId: string, userId: string, _reason: string) {
  return respond(() => {
    if (userId === actorUserId) throw new AppError('FORBIDDEN')
    const record = db.users.find((u) => u.id === userId)
    if (!record) throw new AppError('NOT_FOUND')
    record.status = 'SUSPENDED'
    return undefined
  })
}

/** `POST /admin/users/{id}/reactivate`. */
export function adminReactivateUser(userId: string) {
  return respond(() => {
    const record = db.users.find((u) => u.id === userId)
    if (!record) throw new AppError('NOT_FOUND')
    record.status = 'ACTIVE'
    return undefined
  })
}

/** `GET /admin/clinics`. */
export function adminListClinics() {
  return respond(() => [...db.clinics].sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')))
}

/** `POST /admin/clinics` (R8): clínica parceira (global), nunca privada de uma família. */
export function adminCreateClinic(input: ClinicInput) {
  return respond(() => {
    const clinic: Clinic = {
      id: newId('cln'),
      type: 'PARTNER',
      name: input.name.trim(),
      address: input.address?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim() || undefined,
      status: 'ACTIVE',
    }
    db.clinics.push(clinic)
    return clinic
  })
}

/** `PATCH /admin/clinics/{id}`. */
export function adminUpdateClinic(clinicId: string, patch: ClinicPatch) {
  return respond(() => {
    const clinic = db.clinics.find((c) => c.id === clinicId)
    if (!clinic) throw new AppError('NOT_FOUND')
    if (patch.name !== undefined) clinic.name = patch.name.trim()
    if (patch.address !== undefined) clinic.address = patch.address?.trim() || undefined
    if (patch.phone !== undefined) clinic.phone = patch.phone?.trim() || undefined
    if (patch.email !== undefined) clinic.email = patch.email?.trim() || undefined
    return clinic
  })
}

/** `PUT /admin/clinics/{id}/status`: arquivar não apaga consultas existentes. */
export function adminSetClinicStatus(clinicId: string, status: Clinic['status']) {
  return respond(() => {
    const clinic = db.clinics.find((c) => c.id === clinicId)
    if (!clinic) throw new AppError('NOT_FOUND')
    clinic.status = status
    return clinic
  })
}

/**
 * `POST /admin/clinics/{id}/root-account` (D18/BR-CLN-05): idempotente — repõe a credencial da
 * conta CLINIC_ADMIN existente em vez de criar uma segunda. A palavra-passe (aqui fixa, como nos
 * outros logins de demonstração) seria enviada por e-mail na API real, nunca devolvida.
 */
export function adminCreateOrResetClinicRootAccount(clinicId: string, email: string): Promise<ClinicAccount> {
  return respond(() => {
    if (!db.clinics.some((c) => c.id === clinicId)) throw new AppError('NOT_FOUND')
    const normalized = email.trim().toLowerCase()
    const existing = db.clinicAccounts.find((a) => a.clinicId === clinicId && a.role === 'CLINIC_ADMIN')
    if (existing) {
      existing.email = normalized
      existing.password = DEMO_PASSWORD
      existing.status = 'ACTIVE'
      const { password: _password, ...account } = existing
      return account
    }
    const created = {
      id: newId('cac'),
      clinicId,
      email: normalized,
      password: DEMO_PASSWORD,
      role: 'CLINIC_ADMIN' as const,
      status: 'ACTIVE' as const,
    }
    db.clinicAccounts.push(created)
    const { password: _password, ...account } = created
    return account
  })
}
