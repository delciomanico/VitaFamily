import { localDay } from '@/lib/appointment'
import { AppError } from '@/lib/errors'
import type {
  ClinicAuditEntry,
  ClinicAuditPage,
  ClinicAuditQuery,
  ClinicProfile,
  ClinicProfileField,
  ClinicProfileInput,
  ClinicReceipt,
  ClinicReceiptInput,
  ClinicReceiptLine,
  ClinicReceiptPage,
  ClinicReceiptQuery,
  FamilyClinicReceipt,
  FamilyClinicReceiptPage,
} from '@/types/clinicReceipt'
import {
  PROFILE_LIMITS,
  RECEIPT_DESCRIPTION_MAX,
  RECEIPT_MAX_LINES,
  RECEIPT_MAX_MINOR,
  RECEIPT_NOTE_MAX,
  RECEIPT_NOTICE,
  RECEIPT_VOID_REASON_MAX,
  RECEIPT_VOID_REASON_MIN,
} from '@/types/clinicReceipt'
import { memberName, memberAccess } from '../access'
import { issuedReceiptOf, toFamilyReceipt } from '../clinicReceipts'
import { recordClinicAudit, requireAdminAccount, requireStaffAccount } from '../clinicRoles'
import { CLINIC_CURRENCY } from '../data/clinicCatalog'
import { db, newId, type MockClinicReceipt } from '../db'
import { respond } from '../respond'

/*
 * Recibos, Financeiro, perfil e auditoria da clínica (M14 R, BR-CLN-31..40) e comprovativos do
 * titular (BR-CLN-35). Tudo é da clínica da sessão: um id de outra clínica responde `NOT_FOUND`.
 * O Médico nunca chega aqui (`FORBIDDEN`, authorization.md §6.2b). Nada devolve ids Vita.
 */

const METHODS = ['CASH', 'CARD', 'TRANSFER', 'INSURANCE'] as const
const KINDS = ['APPOINTMENT', 'EXAM', 'VISIT'] as const
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_PERIOD_DAYS = 366

const isMinor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= RECEIPT_MAX_MINOR

/** Marcação concluída da própria clínica, vista de forma uniforme. */
interface ReceiptTarget {
  patientName: string
  slotId?: string
  link: { familyId: string; memberId: string } | null
}

function targetOf(clinicId: string, kind: ClinicReceiptInput['bookingKind'], bookingId: string): ReceiptTarget {
  if (kind === 'VISIT') {
    const visit = db.clinicVisits.find((v) => v.id === bookingId && v.clinicId === clinicId)
    if (!visit) throw new AppError('NOT_FOUND')
    if (visit.status !== 'COMPLETED') throw new AppError('CONFLICT')
    const patient = db.clinicPatients.find((p) => p.id === visit.clinicPatientId)
    // Visita manual: só a clínica (BR-CLN-35).
    return { patientName: patient?.name ?? '', slotId: visit.slotId, link: null }
  }
  const booking =
    kind === 'APPOINTMENT'
      ? db.appointments.find((a) => a.id === bookingId && a.clinicId === clinicId)
      : db.examinations.find((e) => e.id === bookingId && e.slotId && e.clinicId === clinicId)
  if (!booking) throw new AppError('NOT_FOUND')
  if (booking.status !== 'COMPLETED') throw new AppError('CONFLICT')
  // Ligação ao paciente só com consentimento (qualquer nível) na emissão; nunca retroativa (BR-CLN-35).
  const consented = db.clinicConsents.some((c) => c.memberId === booking.memberId && c.clinicId === clinicId)
  return {
    patientName: memberName(booking.memberId),
    slotId: booking.slotId,
    link: consented ? { familyId: booking.familyId, memberId: booking.memberId } : null,
  }
}

function buildLines(clinicId: string, input: ClinicReceiptInput, slotId: string | undefined): ClinicReceiptLine[] {
  const service = (id: string) => db.services.find((s) => s.id === id && s.clinicId === clinicId)
  const lines: ClinicReceiptLine[] = []
  if (input.lines === undefined) {
    // "Um toque": uma linha com o serviço do horário da marcação.
    const serviceId = db.slots.find((s) => s.id === slotId)?.serviceTypeId
    const catalog = serviceId ? service(serviceId) : undefined
    if (!catalog || catalog.priceMinor === undefined) throw new AppError('VALIDATION_ERROR')
    lines.push({ position: 1, description: catalog.name, amountMinor: catalog.priceMinor, serviceTypeId: catalog.id })
    return lines
  }
  if (input.lines.length < 1 || input.lines.length > RECEIPT_MAX_LINES) throw new AppError('VALIDATION_ERROR')
  input.lines.forEach((line, index) => {
    if (line.serviceTypeId) {
      const catalog = service(line.serviceTypeId)
      if (!catalog) throw new AppError('NOT_FOUND')
      if (catalog.priceMinor === undefined) throw new AppError('VALIDATION_ERROR')
      if (line.amountMinor !== undefined && !isMinor(line.amountMinor)) throw new AppError('VALIDATION_ERROR')
      lines.push({
        position: index + 1,
        description: catalog.name,
        amountMinor: line.amountMinor ?? catalog.priceMinor,
        serviceTypeId: catalog.id,
      })
      return
    }
    const description = line.description?.trim() ?? ''
    if (!description || description.length > RECEIPT_DESCRIPTION_MAX || !isMinor(line.amountMinor)) {
      throw new AppError('VALIDATION_ERROR')
    }
    lines.push({ position: index + 1, description, amountMinor: line.amountMinor, serviceTypeId: null })
  })
  return lines
}

function receiptOf(clinicId: string, id: string): MockClinicReceipt {
  const receipt = db.clinicReceipts.find((r) => r.id === id && r.clinicId === clinicId)
  if (!receipt) throw new AppError('NOT_FOUND')
  return receipt
}

/** Sem `clinicId` nem a ligação ao paciente: o que o contrato devolve ao portal. */
function toPortalReceipt({ clinicId: _c, link, ...receipt }: MockClinicReceipt): ClinicReceipt {
  return { ...receipt, availableToPatient: link !== null }
}

/**
 * `POST /clinic-portal/receipts` (BR-CLN-31/32/34/35): recibo de uma marcação concluída. Um só
 * `ISSUED` por marcação; número sequencial por clínica sem buracos (validação antes de numerar).
 */
export function issueClinicReceipt(clinicAccountId: string, input: ClinicReceiptInput, now: Date = new Date()) {
  return respond((): ClinicReceipt => {
    const account = requireStaffAccount(clinicAccountId)
    const { clinicId } = account
    if (!KINDS.includes(input.bookingKind) || !METHODS.includes(input.paymentMethod)) throw new AppError('VALIDATION_ERROR')
    const note = input.note?.trim() || null
    if (note && note.length > RECEIPT_NOTE_MAX) throw new AppError('VALIDATION_ERROR')
    const target = targetOf(clinicId, input.bookingKind, input.bookingId)
    if (issuedReceiptOf(input.bookingKind, input.bookingId)) throw new AppError('CONFLICT')
    const lines = buildLines(clinicId, input, target.slotId)
    const totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0)
    if (totalMinor < 1 || totalMinor > RECEIPT_MAX_MINOR) throw new AppError('VALIDATION_ERROR')

    // Tudo validado: só agora se consome o número (sem buracos).
    const number = (db.clinicReceiptCounters[clinicId] ?? 0) + 1
    db.clinicReceiptCounters[clinicId] = number
    const clinic = db.clinics.find((c) => c.id === clinicId)
    const receipt: MockClinicReceipt = {
      id: newId('rcp'),
      clinicId,
      number,
      bookingKind: input.bookingKind,
      bookingId: input.bookingId,
      status: 'ISSUED',
      paymentMethod: input.paymentMethod,
      currency: CLINIC_CURRENCY,
      totalMinor,
      patientName: target.patientName,
      note,
      issuer: {
        name: clinic?.displayName ?? clinic?.name ?? '',
        address: clinic?.address ?? null,
        phone: clinic?.phone ?? null,
        email: clinic?.email ?? null,
      },
      lines,
      issuedAt: now.toISOString(),
      issuedByClinicAccountId: account.id,
      voidedAt: null,
      voidReason: null,
      voidedByClinicAccountId: null,
      notice: RECEIPT_NOTICE,
      availableToPatient: target.link !== null,
      link: target.link,
    }
    db.clinicReceipts.push(receipt)
    recordClinicAudit(account, 'CLINIC_RECEIPT_ISSUE', 'ClinicReceipt', receipt.id, 'SUCCESS', now)
    return toPortalReceipt(receipt)
  })
}

/** `POST /clinic-portal/receipts/{id}/void` (BR-CLN-33): irreversível; o motivo fica na clínica. */
export function voidClinicReceipt(clinicAccountId: string, receiptId: string, reason: string, now: Date = new Date()) {
  return respond((): ClinicReceipt => {
    const account = requireStaffAccount(clinicAccountId)
    const receipt = receiptOf(account.clinicId, receiptId)
    const text = (reason ?? '').trim()
    if (text.length < RECEIPT_VOID_REASON_MIN || text.length > RECEIPT_VOID_REASON_MAX) throw new AppError('VALIDATION_ERROR')
    if (receipt.status === 'VOIDED') throw new AppError('CONFLICT')
    receipt.status = 'VOIDED'
    receipt.voidedAt = now.toISOString()
    receipt.voidReason = text
    receipt.voidedByClinicAccountId = account.id
    recordClinicAudit(account, 'CLINIC_RECEIPT_VOID', 'ClinicReceipt', receipt.id, 'SUCCESS', now)
    return toPortalReceipt(receipt)
  })
}

/** `GET /clinic-portal/receipts/{id}`. */
export function getClinicReceipt(clinicAccountId: string, receiptId: string) {
  return respond((): ClinicReceipt => toPortalReceipt(receiptOf(requireStaffAccount(clinicAccountId).clinicId, receiptId)))
}

const daysBetween = (from: string, to: string) => {
  const [fy = 0, fm = 1, fd = 1] = from.split('-').map(Number)
  const [ty = 0, tm = 1, td = 1] = to.split('-').map(Number)
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000 + 1
}

/**
 * `GET /clinic-portal/receipts?from&to&status&limit&cursor` (BR-CLN-37): dias locais inclusivos,
 * `issuedAt` decrescente; `summary` do período inteiro (os anulados não somam).
 */
export function listClinicReceipts(clinicAccountId: string, query: ClinicReceiptQuery) {
  return respond((): ClinicReceiptPage => {
    const { clinicId } = requireStaffAccount(clinicAccountId)
    const { from, to, status } = query
    if (!DAY_PATTERN.test(from ?? '') || !DAY_PATTERN.test(to ?? '') || to < from) throw new AppError('VALIDATION_ERROR')
    if (daysBetween(from, to) > MAX_PERIOD_DAYS) throw new AppError('VALIDATION_ERROR')
    if (status !== undefined && status !== 'ISSUED' && status !== 'VOIDED') throw new AppError('VALIDATION_ERROR')
    const limit = query.limit ?? 25
    const offset = query.cursor === undefined ? 0 : Number(query.cursor)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new AppError('VALIDATION_ERROR')
    }
    const inPeriod = db.clinicReceipts.filter((r) => {
      const day = localDay(r.issuedAt)
      return r.clinicId === clinicId && day >= from && day <= to
    })
    const summary = {
      issuedCount: inPeriod.filter((r) => r.status === 'ISSUED').length,
      issuedTotalMinor: inPeriod.filter((r) => r.status === 'ISSUED').reduce((sum, r) => sum + r.totalMinor, 0),
      voidedCount: inPeriod.filter((r) => r.status === 'VOIDED').length,
      currency: CLINIC_CURRENCY,
    }
    const sorted = inPeriod
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.number - a.number)
    return {
      items: sorted.slice(offset, offset + limit).map(toPortalReceipt),
      nextCursor: offset + limit < sorted.length ? String(offset + limit) : null,
      summary,
    }
  })
}

// --- Perfil (`/clinic-portal/profile`, BR-CLN-38) ---

function profileOf(clinicId: string): ClinicProfile {
  const clinic = db.clinics.find((c) => c.id === clinicId)
  if (!clinic) throw new AppError('NOT_FOUND')
  return {
    name: clinic.name,
    displayName: clinic.displayName ?? null,
    address: clinic.address ?? null,
    phone: clinic.phone ?? null,
    email: clinic.email ?? null,
    openingHours: clinic.openingHours ?? null,
    description: clinic.description ?? null,
    currency: CLINIC_CURRENCY,
  }
}

/** `GET /clinic-portal/profile`: Admin e Gestor. */
export function getClinicProfile(clinicAccountId: string) {
  return respond((): ClinicProfile => profileOf(requireStaffAccount(clinicAccountId).clinicId))
}

/** `PATCH /clinic-portal/profile`: só o Admin; parcial, `null` limpa; `name`/`currency` não são aceites. */
export function updateClinicProfile(clinicAccountId: string, input: ClinicProfileInput) {
  return respond((): ClinicProfile => {
    const account = requireAdminAccount(clinicAccountId)
    const fields = Object.keys(input) as ClinicProfileField[]
    if (fields.length === 0 || fields.some((f) => !(f in PROFILE_LIMITS))) throw new AppError('VALIDATION_ERROR')
    const clean: Partial<Record<ClinicProfileField, string | null>> = {}
    for (const field of fields) {
      const value = input[field]
      if (value === null) {
        clean[field] = null
        continue
      }
      if (typeof value !== 'string') throw new AppError('VALIDATION_ERROR')
      const text = value.trim()
      if (text.length > PROFILE_LIMITS[field]) throw new AppError('VALIDATION_ERROR')
      if (field === 'displayName' && text.length < 1) throw new AppError('VALIDATION_ERROR')
      if (field === 'email' && text && !EMAIL_PATTERN.test(text)) throw new AppError('VALIDATION_ERROR')
      clean[field] = text || null
    }
    const clinic = db.clinics.find((c) => c.id === account.clinicId)
    if (!clinic) throw new AppError('NOT_FOUND')
    for (const field of fields) clinic[field] = clean[field] ?? undefined
    recordClinicAudit(account, 'CLINIC_PROFILE_UPDATE', 'Clinic', clinic.id)
    return profileOf(clinic.id)
  })
}

// --- Auditoria da própria clínica (`/clinic-portal/audit`, BR-CLN-40) ---

const AUDIT_RETENTION_MONTHS = 24

/** `GET /clinic-portal/audit`: só o Admin; só ações das contas desta clínica; sem PII. */
export function listClinicAudit(clinicAccountId: string, query: ClinicAuditQuery = {}, now: Date = new Date()) {
  return respond((): ClinicAuditPage => {
    const { clinicId } = requireAdminAccount(clinicAccountId)
    const from = query.from === undefined ? undefined : Date.parse(query.from)
    const to = query.to === undefined ? undefined : Date.parse(query.to)
    if ((from !== undefined && Number.isNaN(from)) || (to !== undefined && Number.isNaN(to))) {
      throw new AppError('VALIDATION_ERROR')
    }
    if (from !== undefined && to !== undefined && (to < from || to - from > MAX_PERIOD_DAYS * 86_400_000)) {
      throw new AppError('VALIDATION_ERROR')
    }
    const retention = new Date(now)
    retention.setMonth(retention.getMonth() - AUDIT_RETENTION_MONTHS)
    if (from !== undefined && from < retention.getTime()) throw new AppError('VALIDATION_ERROR')
    const limit = query.limit ?? 50
    const offset = query.cursor === undefined ? 0 : Number(query.cursor)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new AppError('VALIDATION_ERROR')
    }
    const sorted = db.clinicAudit
      .filter(
        (e) =>
          e.clinicId === clinicId &&
          (from === undefined || Date.parse(e.occurredAt) >= from) &&
          (to === undefined || Date.parse(e.occurredAt) <= to) &&
          (!query.action || e.action === query.action) &&
          (!query.actorAccountId || e.actorAccountId === query.actorAccountId),
      )
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    const items = sorted.slice(offset, offset + limit).map(
      (e): ClinicAuditEntry => ({
        id: e.id,
        occurredAt: e.occurredAt,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        result: e.result,
        actorAccountId: e.actorAccountId,
      }),
    )
    return { items, nextCursor: offset + limit < sorted.length ? String(offset + limit) : null }
  })
}

// --- Lado família (`/families/{f}/members/{m}/clinic-receipts`, BR-CLN-35) ---

/** Só o titular (SELF) ou o tutor; `DEPENDENT_SELF` e `OTHER` → FORBIDDEN (authorization.md §6.5). */
function requireHolder(familyId: string, userId: string, memberId: string) {
  if (!memberAccess(familyId, userId, memberId).manage) throw new AppError('FORBIDDEN')
}

const linkedReceipts = (familyId: string, memberId: string) =>
  db.clinicReceipts.filter((r) => r.link?.familyId === familyId && r.link.memberId === memberId)

/** `GET …/clinic-receipts`: só recibos com ligação (marcação Vita com consentimento na emissão). */
export function listFamilyClinicReceipts(
  familyId: string,
  userId: string,
  memberId: string,
  params: { limit?: number; cursor?: string } = {},
) {
  return respond((): FamilyClinicReceiptPage => {
    requireHolder(familyId, userId, memberId)
    const limit = params.limit ?? 25
    const offset = params.cursor === undefined ? 0 : Number(params.cursor)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new AppError('VALIDATION_ERROR')
    }
    const sorted = linkedReceipts(familyId, memberId).sort(
      (a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.number - a.number,
    )
    return {
      items: sorted.slice(offset, offset + limit).map(toFamilyReceipt),
      nextCursor: offset + limit < sorted.length ? String(offset + limit) : null,
    }
  })
}

/** `GET …/clinic-receipts/{receiptId}`. */
export function getFamilyClinicReceipt(familyId: string, userId: string, memberId: string, receiptId: string) {
  return respond((): FamilyClinicReceipt => {
    requireHolder(familyId, userId, memberId)
    const receipt = linkedReceipts(familyId, memberId).find((r) => r.id === receiptId)
    if (!receipt) throw new AppError('NOT_FOUND')
    return toFamilyReceipt(receipt)
  })
}
