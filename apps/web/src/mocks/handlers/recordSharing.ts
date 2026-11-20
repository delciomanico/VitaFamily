import { AppError } from '@/lib/errors'
import { luandaDayISO } from '@/lib/format'
import { MAX_ACTIVE_SHARES, ageBetween } from '@/lib/recordSharing'
import type { Page } from '@/types/marketplace'
import type {
  CreateRecordShareInput,
  ProfessionalShare,
  ProfessionalShareQuery,
  RecordShare,
  RecordShareCategory,
  RecordShareOptions,
  RecordShareStatus,
  RecordShareView,
  SharedBloodType,
  SharedRecordsView,
  ShareValidity,
} from '@/types/recordSharing'
import { RECORD_SHARE_CATEGORIES, SHARE_VALIDITIES } from '@/types/recordSharing'
import { consultationsDb, type MockBooking } from '../consultationsDb'
import { db } from '../db'
import { recordSharingDb, shareId, type MockShare } from '../recordSharingDb'
import { respond } from '../respond'
import { requireBooking } from './consultations'
import { publicProfessionalName } from './marketplace'
import { requireProfessional } from './professionalPortal'

/*
 * Partilha de registos com prazo e visualização única (MK4: `/families/{f}/members/{m}/record-shares*` e
 * `/professional-portal/shares*`). Só `SELF` ou `TUTOR_OF` partilham (ação `SHARE_WITH_PROFESSIONALS`). O
 * profissional vê só o `participantLabel`, a idade e o que a partilha concede; abrir reavalia tudo a cada
 * pedido e as causas de recusa não se distinguem (BR-MKT-70). O conteúdo nunca é guardado.
 */

const HOUR = 3_600_000
const DAY = 86_400_000
const PAGE_SIZE = 25
const MAX_PER_DAY = 20
const MEDICATION_ONLY: RecordShareCategory[] = ['MEDICATION']
const MONTHS_24 = 730 * DAY

function pageOf<T>(all: T[], limit: number | undefined, cursor: string | undefined): Page<T> {
  const size = Math.min(Math.max(limit ?? PAGE_SIZE, 1), 100)
  const start = cursor ? Number(cursor) : 0
  if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
  return { items: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null }
}

/** Categorias permitidas por categoria do profissional (BR-MKT-68): `WELLNESS` só medicação. */
export const allowedCategoriesFor = (category: 'HEALTH' | 'WELLNESS'): RecordShareCategory[] => (category === 'HEALTH' ? [...RECORD_SHARE_CATEGORIES] : [...MEDICATION_ONLY])

export function derivedStatus(share: MockShare, now = Date.now()): RecordShareStatus {
  if (share.status === 'ACTIVE' && Date.parse(share.expiresAt) <= now) return 'EXPIRED'
  return share.status
}

const viewsOf = (id: string) => recordSharingDb.views.filter((v) => v.shareId === id)

/** `expiresAt` calculado pelo servidor uma vez, nunca mais de 30 dias (BR-MKT-69). */
function expiresAtFor(validity: ShareValidity, booking: MockBooking, now: number): number {
  const cap = now + 30 * DAY
  switch (validity) {
    case 'H24':
      return now + 24 * HOUR
    case 'D7':
      return now + 7 * DAY
    case 'D30':
      return cap
    case 'UNTIL_CONSULTATION_END_PLUS_24H':
      return Math.min(Date.parse(booking.endsAt) + 24 * HOUR, cap)
  }
}

const activeCount = (memberId: string, now = Date.now()) => recordSharingDb.shares.filter((s) => s.memberId === memberId && derivedStatus(s, now) === 'ACTIVE').length

/** A marcação do membro, `CONFIRMED` ou `COMPLETED` (outras ⇒ `INVALID_STATE_TRANSITION`; alheia ⇒ `NOT_FOUND`). */
function shareableBooking(familyId: string, memberId: string, bookingId: string): MockBooking {
  const booking = consultationsDb.bookings.find((b) => b.id === bookingId && b.familyId === familyId && b.memberId === memberId)
  if (!booking) throw new AppError('NOT_FOUND')
  if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') throw new AppError('INVALID_STATE_TRANSITION')
  return booking
}

function toRecordShare(s: MockShare): RecordShare {
  const views = viewsOf(s.id)
  const last = [...views].sort((a, b) => b.viewedAt.localeCompare(a.viewedAt))[0]
  return {
    id: s.id,
    bookingId: s.bookingId,
    professional: publicProfessionalName(s.professionalId) ?? { id: s.professionalId, displayName: 'Profissional' },
    categories: s.categories,
    validity: s.validity,
    viewOnce: s.viewOnce,
    status: derivedStatus(s),
    expiresAt: s.expiresAt,
    revokedAt: s.revokedAt,
    consumedAt: s.consumedAt,
    viewCount: views.length,
    lastViewedAt: last?.viewedAt,
    createdAt: s.createdAt,
  }
}

function ownShare(familyId: string, userId: string, memberId: string, id: string): MockShare {
  requireBooking(familyId, userId, memberId)
  const share = recordSharingDb.shares.find((s) => s.id === id && s.familyId === familyId && s.memberId === memberId)
  if (!share) throw new AppError('NOT_FOUND')
  return share
}

// ───── Família (UC-MKT-48..52) ─────

export function getRecordShareOptions(familyId: string, userId: string, memberId: string, bookingId: string): Promise<RecordShareOptions> {
  return respond(() => {
    requireBooking(familyId, userId, memberId)
    const booking = shareableBooking(familyId, memberId, bookingId)
    const now = Date.now()
    return {
      bookingId: booking.id,
      professional: publicProfessionalName(booking.professionalId) ?? { id: booking.professionalId, displayName: 'Profissional' },
      professionalCategory: booking.offer.category,
      allowedCategories: allowedCategoriesFor(booking.offer.category),
      validities: SHARE_VALIDITIES.map((validity) => {
        const at = expiresAtFor(validity, booking, now)
        return { validity, expiresAt: new Date(at).toISOString(), eligible: at > now }
      }),
      viewOnceAllowed: true,
      maxActive: MAX_ACTIVE_SHARES,
      activeCount: activeCount(memberId, now),
    }
  })
}

export function createRecordShare(familyId: string, userId: string, memberId: string, input: CreateRecordShareInput): Promise<RecordShare> {
  return respond(() => {
    requireBooking(familyId, userId, memberId)
    if (input.clientRequestId) {
      const existing = recordSharingDb.shares.find((s) => s.memberId === memberId && s.clientRequestId === input.clientRequestId)
      if (existing) {
        if (existing.bookingId !== input.bookingId) throw new AppError('CONFLICT')
        return toRecordShare(existing)
      }
    }
    const booking = shareableBooking(familyId, memberId, input.bookingId)
    const allowed = allowedCategoriesFor(booking.offer.category)
    const categories = input.categories
    if (
      categories.length < 1 ||
      categories.length > 5 ||
      new Set(categories).size !== categories.length ||
      !categories.every((c) => allowed.includes(c)) ||
      !SHARE_VALIDITIES.includes(input.validity)
    )
      throw new AppError('VALIDATION_ERROR')
    const now = Date.now()
    const expires = expiresAtFor(input.validity, booking, now)
    if (expires <= now) throw new AppError('VALIDATION_ERROR')
    if (activeCount(memberId, now) >= MAX_ACTIVE_SHARES) throw new AppError('LIMIT_EXCEEDED')
    if (recordSharingDb.creations.filter((c) => c.userId === userId && now - c.at < DAY).length >= MAX_PER_DAY) throw new AppError('RATE_LIMITED')
    recordSharingDb.creations.push({ userId, at: now })
    const share: MockShare = {
      id: shareId('shr'),
      familyId,
      memberId,
      bookingId: booking.id,
      professionalId: booking.professionalId,
      professionalCategory: booking.offer.category,
      participantLabel: booking.participantLabel,
      categories: RECORD_SHARE_CATEGORIES.filter((c) => categories.includes(c)),
      validity: input.validity,
      viewOnce: input.viewOnce === true,
      status: 'ACTIVE',
      expiresAt: new Date(expires).toISOString(),
      clientRequestId: input.clientRequestId,
      createdAt: new Date(now).toISOString(),
    }
    recordSharingDb.shares.push(share)
    return toRecordShare(share)
  })
}

export function listRecordShares(familyId: string, userId: string, memberId: string, query: { bookingId?: string; status?: RecordShareStatus; limit?: number; cursor?: string } = {}): Promise<Page<RecordShare>> {
  return respond(() => {
    requireBooking(familyId, userId, memberId)
    const all = recordSharingDb.shares
      .filter((s) => s.familyId === familyId && s.memberId === memberId && (!query.bookingId || s.bookingId === query.bookingId))
      .map(toRecordShare)
      .filter((s) => !query.status || s.status === query.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return pageOf(all, query.limit, query.cursor)
  })
}

export function getRecordShare(familyId: string, userId: string, memberId: string, id: string): Promise<RecordShare> {
  return respond(() => toRecordShare(ownShare(familyId, userId, memberId, id)))
}

export function revokeRecordShare(familyId: string, userId: string, memberId: string, id: string): Promise<RecordShare> {
  return respond(() => {
    const share = ownShare(familyId, userId, memberId, id)
    if (derivedStatus(share) !== 'ACTIVE') throw new AppError('INVALID_STATE_TRANSITION')
    share.status = 'REVOKED'
    share.revokedAt = new Date().toISOString()
    return toRecordShare(share)
  })
}

export function listRecordShareViews(familyId: string, userId: string, memberId: string, id: string, query: { limit?: number; cursor?: string } = {}): Promise<Page<RecordShareView>> {
  return respond(() => {
    const share = ownShare(familyId, userId, memberId, id)
    const name = publicProfessionalName(share.professionalId)?.displayName ?? 'Profissional'
    const all = viewsOf(share.id)
      .sort((a, b) => b.viewNo - a.viewNo)
      .map((v) => ({ viewNo: v.viewNo, viewedAt: v.viewedAt, professionalName: name, categories: v.categories }))
    return pageOf(all, query.limit, query.cursor)
  })
}

// ───── Profissional (UC-MKT-53..55) ─────

/** Aberta só se `ACTIVE`, no prazo, profissional `APPROVED`, marcação válida e membro ativo (BR-MKT-70). */
function openBlocker(share: MockShare, approved: boolean): 'CONSUMED' | 'UNAVAILABLE' | null {
  if (share.status === 'CONSUMED') return 'CONSUMED'
  const booking = consultationsDb.bookings.find((b) => b.id === share.bookingId)
  const member = db.members.find((m) => m.id === share.memberId && m.familyId === share.familyId)
  const valid = derivedStatus(share) === 'ACTIVE' && approved && booking !== undefined && (booking.status === 'CONFIRMED' || booking.status === 'COMPLETED') && member?.status === 'ACTIVE'
  return valid ? null : 'UNAVAILABLE'
}

function toProfessionalShare(share: MockShare, approved: boolean): ProfessionalShare {
  const views = viewsOf(share.id)
  const last = [...views].sort((a, b) => b.viewedAt.localeCompare(a.viewedAt))[0]
  return {
    id: share.id,
    bookingId: share.bookingId,
    participantLabel: share.participantLabel,
    categories: share.categories,
    validity: share.validity,
    viewOnce: share.viewOnce,
    status: derivedStatus(share),
    expiresAt: share.expiresAt,
    openCount: views.length,
    lastOpenedAt: last?.viewedAt,
    canOpen: openBlocker(share, approved) === null,
    createdAt: share.createdAt,
  }
}

function ownProfessionalShare(professionalId: string, id: string): MockShare {
  const share = recordSharingDb.shares.find((s) => s.id === id && s.professionalId === professionalId)
  if (!share) throw new AppError('NOT_FOUND')
  return share
}

export function listProfessionalShares(query: ProfessionalShareQuery = {}): Promise<Page<ProfessionalShare>> {
  return respond(() => {
    const record = requireProfessional()
    const approved = record.validationStatus === 'APPROVED'
    const all = recordSharingDb.shares
      .filter((s) => s.professionalId === record.id && (!query.bookingId || s.bookingId === query.bookingId))
      .map((s) => toProfessionalShare(s, approved))
      .filter((s) => !query.status || s.status === query.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return pageOf(all, undefined, query.cursor)
  })
}

export function getProfessionalShare(id: string): Promise<ProfessionalShare> {
  return respond(() => {
    const record = requireProfessional()
    return toProfessionalShare(ownProfessionalShare(record.id, id), record.validationStatus === 'APPROVED')
  })
}

const BLOOD: Record<string, SharedBloodType> = { 'A+': 'A_POS', 'A-': 'A_NEG', 'B+': 'B_POS', 'B-': 'B_NEG', 'AB+': 'AB_POS', 'AB-': 'AB_NEG', 'O+': 'O_POS', 'O-': 'O_NEG' }

/** Lê só as categorias concedidas, no mínimo necessário: sem notas, motivos, documentos, tomas nem ids (BR-MKT-68). */
function readRecords(share: MockShare, openedAt: Date, professionalName: string): SharedRecordsView {
  const member = db.members.find((m) => m.id === share.memberId && m.familyId === share.familyId)
  if (!member) throw new AppError('NOT_FOUND')
  const now = openedAt.getTime()
  const openedOn = luandaDayISO(openedAt)
  const view: SharedRecordsView = {
    shareId: share.id,
    participantLabel: share.participantLabel,
    ageYears: ageBetween(member.birthDate, openedOn),
    openedAt: openedAt.toISOString(),
    expiresAt: share.expiresAt,
    viewOnce: share.viewOnce,
    watermark: { professionalName, openedOn },
  }
  const mine = <T extends { memberId: string; familyId: string }>(rows: T[]) => rows.filter((r) => r.memberId === share.memberId && r.familyId === share.familyId)
  if (share.categories.includes('ALLERGIES')) {
    view.allergies = mine(db.allergies).map((a) => ({ name: a.name, since: a.since }))
    view.bloodType = member.bloodType ? (BLOOD[member.bloodType] ?? 'UNKNOWN') : 'UNKNOWN'
  }
  if (share.categories.includes('CONDITIONS')) view.conditions = mine(db.conditions).map((c) => ({ name: c.name, kind: c.kind, since: c.since, until: c.until }))
  if (share.categories.includes('MEDICATION')) {
    view.medications = mine(db.medicationPlans)
      .filter((p) => p.status === 'ACTIVE')
      .map((p) => ({ name: p.name, dosage: p.dosage, startAt: p.startAt, endAt: p.endAt, continuous: p.continuous }))
  }
  if (share.categories.includes('APPOINTMENTS')) {
    view.appointments = mine(db.appointments)
      .filter((a) => Date.parse(a.scheduledAt) >= now - MONTHS_24)
      .map((a) => ({ scheduledAt: a.scheduledAt, status: a.status, specialty: a.specialty, professionalName: a.professionalName }))
  }
  if (share.categories.includes('EXAMS')) {
    view.examinations = mine(db.examinations)
      .filter((e) => e.status !== 'CANCELLED' && Date.parse(e.examDate) >= now - MONTHS_24)
      .map((e) => ({
        name: e.name,
        examDate: e.examDate.slice(0, 10),
        status: e.status as 'SCHEDULED' | 'COMPLETED',
        results: db.examResults
          .filter((r) => r.examinationId === e.id)
          .map((r) => ({ parameter: r.parameter, valueNumeric: r.valueNumeric, valueText: r.valueText, unit: r.unit, referenceMin: r.referenceMin, referenceMax: r.referenceMax })),
      }))
  }
  return view
}

/** `POST …/open`: cada abertura reavalia tudo, regista uma vista e, se for de visualização única, consome-a. */
export function openProfessionalShare(id: string): Promise<SharedRecordsView> {
  return respond(() => {
    const record = requireProfessional()
    const share = ownProfessionalShare(record.id, id)
    const blocked = openBlocker(share, record.validationStatus === 'APPROVED')
    if (blocked === 'CONSUMED') throw new AppError('SHARE_ALREADY_VIEWED')
    if (blocked) throw new AppError('SHARE_NOT_AVAILABLE')
    const openedAt = new Date()
    // Lê primeiro: se a leitura falhar, nada se consome nem se regista.
    const content = readRecords(share, openedAt, record.displayName ?? 'Profissional')
    recordSharingDb.views.push({ shareId: share.id, viewNo: viewsOf(share.id).length + 1, viewedAt: openedAt.toISOString(), categories: share.categories })
    if (share.viewOnce) {
      share.status = 'CONSUMED'
      share.consumedAt = openedAt.toISOString()
    }
    return content
  })
}

