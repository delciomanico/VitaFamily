import type { AdminClinicAccount, AdminUser, AdminUserDetail, AdminUserPage, ClinicInput, ClinicPatch } from '@/types/admin'
import type { Clinic, ClinicAccount } from '@/types/clinic'
import type { InsuranceAccount, Insurer, InsurerInput, InsurerPatch } from '@/types/insurance'
import { AppError } from '@/lib/errors'
import { DEMO_PASSWORD, type MockUserRecord } from '../data/users'
import { db, newId } from '../db'
import { respond } from '../respond'

/** O mock não guarda `createdAt` por utilizador (só a API real, D4/R10): usa a data atual como
 * aproximação só para a UI ter algo a mostrar. */
function toAdminUser({ id, email, name, status }: MockUserRecord): AdminUser {
  return { id, email, name, status, createdAt: new Date().toISOString() }
}

/** `GET /admin/users` (PLATFORM_ADMIN): o conjunto de demonstração é pequeno, nunca pagina de
 * facto — devolve sempre tudo numa só página (`nextCursor: null`) para a UI exercitar o mesmo
 * formato `{items, nextCursor}` da API real sem precisar de "carregar mais" aqui. */
export function adminListUsers(_cursor?: string, q?: string): Promise<AdminUserPage> {
  return respond(() => {
    const term = q?.trim().toLowerCase()
    if (term !== undefined && term.length === 1) throw new AppError('VALIDATION_ERROR')
    return {
      items: db.users
        .filter((u) => !term || u.email.toLowerCase().includes(term) || u.name.toLowerCase().includes(term))
        .map((u) => toAdminUser(u))
        .sort((a, b) => a.email.localeCompare(b.email, 'pt-PT')),
      nextCursor: null,
    }
  })
}

/** `GET /admin/users/{id}`: detalhe operacional, sem nomes de famílias nem de membros (R10). */
export function adminGetUser(userId: string): Promise<AdminUserDetail> {
  return respond(() => {
    const record = db.users.find((u) => u.id === userId)
    if (!record) throw new AppError('NOT_FOUND')
    const suspended = record.status === 'SUSPENDED'
    return {
      ...toAdminUser(record),
      platformRole: record.platformRole,
      emailVerifiedAt: record.status === 'PENDING_VERIFICATION' ? null : new Date().toISOString(),
      suspendedAt: suspended ? new Date().toISOString() : null,
      suspensionReason: suspended ? 'Suspensa pela administração.' : null,
      familiesCount: record.platformRole === 'PLATFORM_ADMIN' ? 0 : 1,
      activeSessionsCount: suspended ? 0 : 1,
      lastSessionUsedAt: suspended ? null : new Date().toISOString(),
    }
  })
}

/** `POST /admin/users/{id}/reset-access`: revoga sessões e envia e-mail; nunca a própria conta. */
export function adminResetUserAccess(actorUserId: string, userId: string) {
  return respond(() => {
    if (userId === actorUserId) throw new AppError('FORBIDDEN')
    if (!db.users.some((u) => u.id === userId)) throw new AppError('NOT_FOUND')
    return undefined
  })
}

/** `GET /admin/clinics/{id}/accounts`. */
export function adminListClinicAccounts(clinicId: string): Promise<AdminClinicAccount[]> {
  return respond(() => {
    if (!db.clinics.some((c) => c.id === clinicId)) throw new AppError('NOT_FOUND')
    return db.clinicAccounts
      .filter((a) => a.clinicId === clinicId)
      .map((a) => ({
        id: a.id,
        clinicId: a.clinicId,
        email: a.email,
        role: a.role,
        status: a.status,
        createdAt: new Date().toISOString(),
        lastLoginAt: a.status === 'ACTIVE' ? new Date().toISOString() : null,
        suspendedAt: a.status === 'SUSPENDED' ? new Date().toISOString() : null,
      }))
      .sort((a, b) => a.email.localeCompare(b.email, 'pt-PT'))
  })
}

/** `POST …/accounts/{id}/suspend`: motivo obrigatório (não é guardado). */
export function adminSuspendClinicAccount(clinicId: string, accountId: string, reason: string) {
  return respond(() => {
    if (!reason.trim()) throw new AppError('VALIDATION_ERROR')
    const account = db.clinicAccounts.find((a) => a.id === accountId && a.clinicId === clinicId)
    if (!account) throw new AppError('NOT_FOUND')
    account.status = 'SUSPENDED'
    return undefined
  })
}

/** `POST …/accounts/{id}/reactivate`: CONFLICT se já houver outro CLINIC_ADMIN ativo. */
export function adminReactivateClinicAccount(clinicId: string, accountId: string) {
  return respond(() => {
    const account = db.clinicAccounts.find((a) => a.id === accountId && a.clinicId === clinicId)
    if (!account) throw new AppError('NOT_FOUND')
    if (
      account.role === 'CLINIC_ADMIN' &&
      db.clinicAccounts.some(
        (a) => a.clinicId === clinicId && a.role === 'CLINIC_ADMIN' && a.status === 'ACTIVE' && a.id !== accountId,
      )
    ) {
      throw new AppError('CONFLICT')
    }
    account.status = 'ACTIVE'
    return undefined
  })
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

/** `GET /admin/insurers`. */
export function adminListInsurers(): Promise<Insurer[]> {
  return respond(() => [...db.insurers].sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')))
}

function assertInsurerFields(name: string | undefined, taxId: string | undefined, exceptId?: string) {
  if (name !== undefined && !name.trim()) throw new AppError('VALIDATION_ERROR')
  if (taxId !== undefined) {
    const normalized = taxId.trim()
    if (!/^\d{9}$/.test(normalized)) throw new AppError('VALIDATION_ERROR')
    if (db.insurers.some((i) => i.taxId === normalized && i.id !== exceptId)) throw new AppError('VALIDATION_ERROR')
  }
}

/** `POST /admin/insurers` (BR-ADM-05): NIF duplicado → 422. */
export function adminCreateInsurer(input: InsurerInput): Promise<Insurer> {
  return respond(() => {
    assertInsurerFields(input.name || undefined, input.taxId)
    if (!input.name.trim()) throw new AppError('VALIDATION_ERROR')
    const insurer: Insurer = {
      id: newId('ins'),
      name: input.name.trim(),
      taxId: input.taxId.trim(),
      status: 'ACTIVE',
    }
    db.insurers.push(insurer)
    return insurer
  })
}

/** `PATCH /admin/insurers/{id}`. */
export function adminUpdateInsurer(insurerId: string, patch: InsurerPatch): Promise<Insurer> {
  return respond(() => {
    const insurer = db.insurers.find((i) => i.id === insurerId)
    if (!insurer) throw new AppError('NOT_FOUND')
    assertInsurerFields(patch.name, patch.taxId, insurerId)
    if (patch.name !== undefined) insurer.name = patch.name.trim()
    if (patch.taxId !== undefined) insurer.taxId = patch.taxId.trim()
    return insurer
  })
}

/** `PUT /admin/insurers/{id}/status`: suspender não apaga apólices nem pedidos existentes. */
export function adminSetInsurerStatus(insurerId: string, status: Insurer['status']): Promise<Insurer> {
  return respond(() => {
    const insurer = db.insurers.find((i) => i.id === insurerId)
    if (!insurer) throw new AppError('NOT_FOUND')
    insurer.status = status
    return insurer
  })
}

/** `POST /admin/insurers/{id}/root-account`: idempotente — repõe a conta INSURANCE_ADMIN existente. */
export function adminCreateOrResetInsurerRootAccount(insurerId: string, email: string): Promise<InsuranceAccount> {
  return respond(() => {
    if (!db.insurers.some((i) => i.id === insurerId)) throw new AppError('NOT_FOUND')
    const normalized = email.trim().toLowerCase()
    if (db.insuranceAccounts.some((a) => a.email === normalized && !(a.insurerId === insurerId && a.role === 'INSURANCE_ADMIN'))) {
      throw new AppError('VALIDATION_ERROR')
    }
    const existing = db.insuranceAccounts.find((a) => a.insurerId === insurerId && a.role === 'INSURANCE_ADMIN')
    if (existing) {
      existing.email = normalized
      existing.password = DEMO_PASSWORD
      existing.status = 'ACTIVE'
      const { password: _password, ...account } = existing
      return account
    }
    const created = {
      id: newId('iac'),
      insurerId,
      email: normalized,
      password: DEMO_PASSWORD,
      role: 'INSURANCE_ADMIN' as const,
      status: 'ACTIVE' as const,
    }
    db.insuranceAccounts.push(created)
    const { password: _password, ...account } = created
    return account
  })
}
