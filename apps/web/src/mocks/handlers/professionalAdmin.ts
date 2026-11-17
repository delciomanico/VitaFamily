import { AppError } from '@/lib/errors'
import { DECISIONS_NEEDS_REASON, decisionsFor } from '@/lib/professional'
import type {
  AdminProfessionalDetail,
  AdminProfessionalFilters,
  AdminProfessionalItem,
  AdminProfessionalPage,
  AdminSpecialty,
  ProfessionalCredential,
  ProfessionalDecisionInput,
  ProfessionalValidationStatus,
  SpecialtyInput,
  SpecialtyPatch,
  ValidationAction,
} from '@/types/professional'
import { adminSpecialtyView, professionalDb, proId, type MockProfessional } from '../professionalDb'
import { respond, respondBlob } from '../respond'
import { generateAllSlots, requirementsOf } from './professionalPortal'

/*
 * Administração do mercado de profissionais (`/admin/professionals*`, `/admin/specialties*`, MK1).
 * Mesma sessão de `User` com `platformRole` das restantes rotas `/admin` (a autorização real é do servidor).
 * O admin NUNCA vê `paymentInstructions`, ofertas, horários nem dados de saúde (BR-MKT-26/27).
 */

const PAGE_SIZE = 20

function recordOf(id: string): MockProfessional {
  const record = professionalDb.professionals.find((p) => p.id === id && p.verified)
  if (!record) throw new AppError('NOT_FOUND')
  return record
}

function specialtiesOf(record: MockProfessional) {
  return professionalDb.specialties.filter((s) => record.specialtyIds.includes(s.id)).map(({ id, name, category }) => ({ id, name, category }))
}

const toCredential = ({ ticks: _t, fileName: _f, ...credential }: MockProfessional['credentials'][number]): ProfessionalCredential => credential

const toItem = (record: MockProfessional): AdminProfessionalItem => ({
  id: record.id,
  displayName: record.displayName,
  email: record.email,
  validationStatus: record.validationStatus,
  submittedAt: record.submittedAt,
  specialties: specialtiesOf(record),
  credentialCount: record.credentials.length,
  createdAt: record.createdAt,
})

/** Fila: omissão `PENDING_REVIEW`, mais antigo primeiro; filtros por estado, categoria e pesquisa (≥ 2 letras). */
export function adminListProfessionals(filters: AdminProfessionalFilters = {}): Promise<AdminProfessionalPage> {
  return respond(() => {
    const status: ProfessionalValidationStatus = filters.status ?? 'PENDING_REVIEW'
    const term = filters.q?.trim().toLowerCase()
    if (term !== undefined && term.length === 1) throw new AppError('VALIDATION_ERROR')
    const all = professionalDb.professionals
      .filter((p) => p.verified && p.validationStatus === status)
      .filter((p) => !filters.category || specialtiesOf(p).some((s) => s.category === filters.category))
      .filter((p) => !term || p.email.toLowerCase().includes(term) || (p.displayName ?? '').toLowerCase().includes(term))
      .sort((a, b) => (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt))
    const start = filters.cursor ? Number(filters.cursor) : 0
    if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
    const items = all.slice(start, start + PAGE_SIZE).map(toItem)
    return { items, nextCursor: start + PAGE_SIZE < all.length ? String(start + PAGE_SIZE) : null }
  })
}

function detailOf(record: MockProfessional): AdminProfessionalDetail {
  return {
      id: record.id,
      email: record.email,
      emailVerifiedAt: record.createdAt,
      displayName: record.displayName,
      bio: record.bio,
      city: record.city,
      validationStatus: record.validationStatus,
      statusReason: record.statusReason,
      statusChangedAt: record.statusChangedAt,
      submittedAt: record.submittedAt,
      approvedAt: record.approvedAt,
      specialties: specialtiesOf(record),
      credentials: record.credentials.map(toCredential),
      history: [...record.history].reverse(),
      createdAt: record.createdAt,
  }
}

export function adminGetProfessional(professionalId: string): Promise<AdminProfessionalDetail> {
  return respond(() => detailOf(recordOf(professionalId)))
}

const OUTCOME: Record<ProfessionalDecisionInput['decision'], { to: ProfessionalValidationStatus; action: ValidationAction }> = {
  APPROVE: { to: 'APPROVED', action: 'APPROVED' },
  REJECT: { to: 'REJECTED', action: 'REJECTED' },
  REQUEST_INFO: { to: 'NEEDS_INFO', action: 'NEEDS_INFO' },
  SUSPEND: { to: 'SUSPENDED', action: 'SUSPENDED' },
  REACTIVATE: { to: 'APPROVED', action: 'REACTIVATED' },
}

/** Decisão (state-machines.md): estado já mudado ⇒ INVALID_STATE_TRANSITION; sem motivo onde é obrigatório ⇒ VALIDATION_ERROR. */
export function adminDecideProfessional(professionalId: string, input: ProfessionalDecisionInput): Promise<AdminProfessionalDetail> {
  return respond(() => {
    const record = recordOf(professionalId)
    if (!decisionsFor[record.validationStatus].includes(input.decision)) throw new AppError('INVALID_STATE_TRANSITION')
    const reason = input.reason?.trim()
    if (DECISIONS_NEEDS_REASON.includes(input.decision) && !reason) throw new AppError('VALIDATION_ERROR')
    if ((reason?.length ?? 0) > 500) throw new AppError('VALIDATION_ERROR')
    // BR-MKT-16 em APPROVE/REACTIVATE (credencial entretanto caducada, em verificação…).
    if ((input.decision === 'APPROVE' || input.decision === 'REACTIVATE') && requirementsOf(record).missing.length > 0) {
      throw new AppError('VALIDATION_ERROR')
    }
    const { to, action } = OUTCOME[input.decision]
    const now = new Date().toISOString()
    record.history.push({ id: proId('val'), action, fromStatus: record.validationStatus, toStatus: to, actor: 'PLATFORM_ADMIN', reason, createdAt: now })
    record.validationStatus = to
    record.statusReason = reason
    record.statusChangedAt = now
    if (to === 'APPROVED') {
      record.approvedAt = record.approvedAt ?? now
      generateAllSlots(record)
    }
    return detailOf(record)
  })
}

/** Download mediado e auditado; só `CLEAN` (`PENDING`/`INFECTED` ⇒ 409). */
export function adminDownloadProfessionalCredential(professionalId: string, credentialId: string): Promise<Blob> {
  return respondBlob(() => {
    const record = recordOf(professionalId)
    const credential = record.credentials.find((c) => c.id === credentialId)
    if (!credential) throw new AppError('NOT_FOUND')
    if (credential.scanStatus !== 'CLEAN') throw new AppError('DOCUMENT_NOT_AVAILABLE')
    return professionalDb.files.get(credential.id) ?? new Blob([], { type: credential.contentType })
  })
}

// ───── Catálogo de especialidades (UC-MKT-07) ─────

const sameName = (a: string, b: string) => a.localeCompare(b, 'pt-PT', { sensitivity: 'accent' }) === 0

function checkName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 80) throw new AppError('VALIDATION_ERROR')
  return trimmed
}

export function adminListSpecialties(): Promise<AdminSpecialty[]> {
  return respond(() => professionalDb.specialties.map(adminSpecialtyView).sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')))
}

export function adminCreateSpecialty(input: SpecialtyInput): Promise<AdminSpecialty> {
  return respond(() => {
    const name = checkName(input.name)
    if (input.category !== 'HEALTH' && input.category !== 'WELLNESS') throw new AppError('VALIDATION_ERROR')
    if (professionalDb.specialties.some((s) => sameName(s.name, name))) throw new AppError('CONFLICT')
    const spec = { id: proId('spc'), name, category: input.category, active: true }
    professionalDb.specialties.push(spec)
    return adminSpecialtyView(spec)
  })
}

export function adminUpdateSpecialty(specialtyId: string, patch: SpecialtyPatch): Promise<AdminSpecialty> {
  return respond(() => {
    const spec = professionalDb.specialties.find((s) => s.id === specialtyId)
    if (!spec) throw new AppError('NOT_FOUND')
    if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_ERROR')
    if (patch.name !== undefined) {
      const name = checkName(patch.name)
      if (professionalDb.specialties.some((s) => s.id !== spec.id && sameName(s.name, name))) throw new AppError('CONFLICT')
      spec.name = name
    }
    if (patch.category !== undefined && patch.category !== spec.category) {
      // Categoria imutável enquanto algum profissional usa a especialidade (BR-MKT-22).
      if (adminSpecialtyView(spec).professionalCount > 0) throw new AppError('CONFLICT')
      spec.category = patch.category
    }
    if (patch.active !== undefined) spec.active = patch.active
    return adminSpecialtyView(spec)
  })
}
