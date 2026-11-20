import { AppError } from '@/lib/errors'
import { PARTICIPANT_LABEL_MAX, NOTE_MAX, PROOF_MAX_BYTES, REVIEW_COMMENT_MAX, plainText, proofFileError } from '@/lib/consultations'
import type { FamilyProcess } from '@/types/process'
import type {
  BookableSlot,
  BookingStatus,
  CreateBookingInput,
  FamilyBooking,
  FamilyReview,
  PaymentProof,
  PublicReview,
  PublicReviewPage,
  ReviewInput,
} from '@/types/consultations'
import type { Page } from '@/types/marketplace'
import { requireSelf, visibleMemberIds } from '../access'
import { ACTIVE_STATUSES, bookingHoldingSlot, consId, consultationsDb, offerFacts, offerSlots, reviewsOf, type MockBooking, type MockProof, type MockReview } from '../consultationsDb'
import { db } from '../db'
import { marketplaceDb } from '../marketplaceDb'
import { professionalDb } from '../professionalDb'
import { respond, respondBlob } from '../respond'
import { prescriptionIdOf } from './professionalPrescriptions'
import { isApprovedProfessional, publicProfessionalName, reviewSummaryOf } from './marketplace'

/*
 * Marcações, comprovativos e avaliações do lado da família (MK3: `/families/{f}/members/{m}/bookings*` e
 * `/marketplace/professionals/{id}/{slots,reviews}`). Só `SELF` ou `TUTOR_OF` marcam (ação `BOOK_PROFESSIONALS`);
 * o estado do pagamento é declarativo e a Vita Family não valida dinheiro (BR-MKT-56). Texto livre nunca é registado.
 */

const HOUR = 3_600_000
const DAY = 86_400_000
const MIN_LEAD_MS = 2 * HOUR
const MAX_LEAD_MS = 56 * DAY
const MAX_ACTIVE_PER_MEMBER = 10
const MAX_PROOFS = 5
const REVIEW_WINDOW_MS = 30 * DAY
const REVIEW_EDIT_MS = 7 * DAY
const PAGE_SIZE = 25

function pageOf<T>(all: T[], limit: number | undefined, cursor: string | undefined): Page<T> {
  const size = Math.min(Math.max(limit ?? PAGE_SIZE, 1), 100)
  const start = cursor ? Number(cursor) : 0
  if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
  return { items: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null }
}

/** Profissional `APPROVED` (conta aprovada com oferta ativa, ou do catálogo). */
function professionalApproved(professionalId: string): boolean {
  return isApprovedProfessional(professionalId)
}

// ───── Regras partilhadas com o portal (estado derivado) ─────

export const isActive = (b: MockBooking) => ACTIVE_STATUSES.includes(b.status)
export const paymentSatisfied = (b: MockBooking) => b.paymentStatus === 'CONFIRMED' || b.paymentStatus === 'NOT_REQUIRED'
const payable = (b: MockBooking) => (b.status === 'CONFIRMED' || b.status === 'COMPLETED') && b.priceKz > 0

export function reviewWindowOpen(b: MockBooking, now = Date.now()): boolean {
  return b.status === 'COMPLETED' && b.completedAt !== undefined && paymentSatisfied(b) && now <= Date.parse(b.completedAt) + REVIEW_WINDOW_MS
}

export const reviewOfBooking = (bookingId: string) => consultationsDb.reviews.find((r) => r.bookingId === bookingId)

function cancelledLate(b: MockBooking): boolean {
  return b.cancelledBy === 'FAMILY' && b.cancelledAt !== undefined && Date.parse(b.startsAt) - Date.parse(b.cancelledAt) < DAY
}

/** Antivírus simulado: um comprovativo `PENDING` fica `CLEAN` na leitura seguinte; nomes com «eicar» ficam infetados (OP-114). */
export function settleScans(bookingId: string) {
  for (const proof of consultationsDb.proofs.filter((p) => p.bookingId === bookingId && p.scanStatus === 'PENDING')) {
    if (proof.fileName.toLowerCase().includes('eicar')) {
      // Infetado: a linha apaga-se e o pagamento volta a «falta o comprovativo» (BR-MKT-57, OP-114).
      consultationsDb.proofs = consultationsDb.proofs.filter((p) => p.id !== proof.id)
      consultationsDb.proofFiles.delete(proof.id)
      const booking = consultationsDb.bookings.find((b) => b.id === bookingId)
      if (booking && booking.paymentStatus === 'PROOF_SUBMITTED') booking.paymentStatus = 'AWAITING_PROOF'
    } else proof.scanStatus = 'CLEAN'
  }
}

export function toProof(p: MockProof): PaymentProof {
  return {
    id: p.id,
    bookingId: p.bookingId,
    status: p.status,
    scanStatus: p.scanStatus,
    contentType: p.contentType,
    sizeBytes: p.sizeBytes,
    decisionReason: p.decisionReason,
    disputeNote: p.disputeNote,
    disputeDecision: p.disputeDecision,
    decidedAt: p.decidedAt,
    disputedAt: p.disputedAt,
    purged: p.purged,
    createdAt: p.createdAt,
  }
}

export const proofsOf = (bookingId: string) => consultationsDb.proofs.filter((p) => p.bookingId === bookingId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

// ───── Processo derivado (BR-MKT-55; state-machines.md 1b/2b) ─────

type Hint = 'PAYMENT_PROOF_DUE' | 'PAYMENT_UNDER_REVIEW' | 'PAYMENT_DISPUTED' | 'REVIEW_DUE'

function hintOf(b: MockBooking): Hint | undefined {
  if (b.status !== 'CONFIRMED' && b.status !== 'COMPLETED') return undefined
  if (b.paymentStatus === 'AWAITING_PROOF' || b.paymentStatus === 'REJECTED') return 'PAYMENT_PROOF_DUE'
  if (b.paymentStatus === 'PROOF_SUBMITTED') return 'PAYMENT_UNDER_REVIEW'
  if (b.paymentStatus === 'DISPUTED') return 'PAYMENT_DISPUTED'
  if (reviewWindowOpen(b) && !reviewOfBooking(b.id)) return 'REVIEW_DUE'
  return undefined
}

const HINT_STEP: Record<Hint, { code: string; actor: FamilyProcess['nextStep']['actor'] }> = {
  PAYMENT_PROOF_DUE: { code: 'SEND_PAYMENT_PROOF', actor: 'FAMILY' },
  PAYMENT_UNDER_REVIEW: { code: 'AWAIT_PAYMENT_CONFIRMATION', actor: 'PROFESSIONAL' },
  PAYMENT_DISPUTED: { code: 'AWAIT_PAYMENT_DISPUTE_DECISION', actor: 'PLATFORM' },
  REVIEW_DUE: { code: 'LEAVE_REVIEW', actor: 'FAMILY' },
}

export const processIdOf = (bookingId: string) => `prc_${bookingId}`

/** `Process` `BOOKING`: derivado da marcação a cada leitura, nunca escrito (BR-PRC-02). */
export function processOfBooking(b: MockBooking): FamilyProcess {
  const hint = hintOf(b)
  const base = { id: processIdOf(b.id), memberId: b.memberId, kind: 'ROUTINE', origin: { type: 'BOOKING' as const, id: b.id }, scheduledAt: b.startsAt, openedAt: b.createdAt }
  switch (b.status) {
    case 'REQUESTED':
      return { ...base, familyStatus: 'SCHEDULED', nextStep: { code: 'AWAIT_PROFESSIONAL_RESPONSE', actor: 'PROFESSIONAL' } }
    case 'CONFIRMED':
      return { ...base, familyStatus: 'SCHEDULED', nextStep: hint && hint !== 'REVIEW_DUE' ? HINT_STEP[hint] : { code: 'ATTEND', actor: 'FAMILY' } }
    case 'COMPLETED':
      return { ...base, familyStatus: 'DONE', nextStep: hint ? HINT_STEP[hint] : { code: 'NOTHING_PENDING', actor: 'NONE' } }
    case 'NO_SHOW':
      return { ...base, familyStatus: 'CANCELLED', nextStep: { code: 'RESCHEDULE', actor: 'FAMILY' } }
    default:
      return { ...base, familyStatus: 'CANCELLED', nextStep: { code: 'NOTHING_PENDING', actor: 'NONE' } }
  }
}

/** Processo de uma marcação do membro, para `GET …/processes/{id}`; `undefined` se não for de uma marcação. */
export function bookingProcess(familyId: string, memberId: string, processId: string): FamilyProcess | undefined {
  const booking = consultationsDb.bookings.find((b) => processIdOf(b.id) === processId && b.familyId === familyId && b.memberId === memberId)
  return booking ? processOfBooking(booking) : undefined
}

// ───── Vistas ─────

function toFamilyBooking(b: MockBooking, detail: boolean): FamilyBooking {
  settleScans(b.id)
  const now = Date.now()
  const showInstructions = payable(b)
  const conversation = marketplaceDb.conversations.find((c) => c.familyId === b.familyId && c.memberId === b.memberId && c.professionalId === b.professionalId)
  const professional = publicProfessionalName(b.professionalId) ?? { id: b.professionalId, displayName: 'Profissional' }
  return {
    id: b.id,
    memberId: b.memberId,
    professional,
    offer: b.offer,
    participantLabel: b.participantLabel,
    priceKz: b.priceKz,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    status: b.status,
    paymentStatus: b.paymentStatus,
    statusReason: b.statusReason,
    cancelledBy: b.cancelledBy,
    systemReason: b.systemReason,
    cancelledLate: cancelledLate(b),
    meetingInfo: b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? b.meetingInfo : undefined,
    paymentInstructions: detail && showInstructions ? (offerFacts(b.professionalId, b.offerId)?.paymentInstructions ?? professionalDb.professionals.find((p) => p.id === b.professionalId)?.paymentInstructions) : undefined,
    processId: processIdOf(b.id),
    appointmentId: b.appointmentId,
    conversationId: conversation?.id,
    prescriptionId: prescriptionIdOf(b.id),
    canCancel: isActive(b) && now < Date.parse(b.startsAt),
    canSendProof: showInstructions && (b.paymentStatus === 'AWAITING_PROOF' || b.paymentStatus === 'REJECTED'),
    canReview: reviewWindowOpen(b, now) && !reviewOfBooking(b.id),
    hasReview: reviewOfBooking(b.id) !== undefined,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }
}

/**
 * Ação `BOOK_PROFESSIONALS` (authorization.md §12.1): `SELF` ou `TUTOR_OF`; dependente com conta e restantes
 * ⇒ `FORBIDDEN`; membro/família alheios ⇒ `NOT_FOUND`; membro bloqueado ⇒ `MEMBER_BLOCKED`.
 */
export function requireBooking(familyId: string, userId: string, memberId: string) {
  requireSelf(familyId, userId)
  const member = db.members.find((m) => m.id === memberId && m.familyId === familyId)
  if (!member) throw new AppError('NOT_FOUND')
  if (!visibleMemberIds(familyId, userId).includes(memberId) || (member.isDependent && member.userId)) throw new AppError('FORBIDDEN')
  if (member.status === 'BLOCKED') throw new AppError('MEMBER_BLOCKED')
  return member
}

function ownBooking(familyId: string, userId: string, memberId: string, bookingId: string) {
  requireBooking(familyId, userId, memberId)
  const booking = consultationsDb.bookings.find((b) => b.id === bookingId && b.familyId === familyId && b.memberId === memberId)
  if (!booking) throw new AppError('NOT_FOUND')
  return booking
}

/** BR-MKT-12: o utilizador com o mesmo e-mail do profissional não marca nem avalia o seu próprio serviço. */
function guardSelfDealing(userId: string, professionalId: string) {
  const user = db.users.find((u) => u.id === userId)
  const professional = professionalDb.professionals.find((p) => p.id === professionalId)
  if (user && professional && user.email.trim().toLowerCase() === professional.email.trim().toLowerCase()) throw new AppError('SELF_BOOKING_NOT_ALLOWED')
}

/** Estado da consulta gerada na marcação (BR-MKT-55): mantém-se coerente na mesma operação. */
export function syncAppointment(b: MockBooking) {
  const appointment = b.appointmentId ? db.appointments.find((a) => a.id === b.appointmentId) : undefined
  if (!appointment) return
  appointment.status = b.status === 'CANCELLED' || b.status === 'REJECTED' ? 'CANCELLED' : b.status === 'COMPLETED' ? 'COMPLETED' : b.status === 'NO_SHOW' ? 'NO_SHOW' : 'SCHEDULED'
}

// ───── Públicas: horários livres e avaliações (UC-MKT-26/40) ─────

export function listBookableSlots(professionalId: string, offerId: string, from?: string, to?: string): Promise<BookableSlot[]> {
  return respond(() => {
    if (!professionalApproved(professionalId)) throw new AppError('NOT_FOUND')
    const facts = offerFacts(professionalId, offerId)
    if (!facts) throw new AppError('NOT_FOUND')
    const now = Date.now()
    const start = from ? Date.parse(from) : now
    const end = to ? Date.parse(to) : start + 14 * DAY
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > 62 * DAY) throw new AppError('VALIDATION_ERROR')
    return offerSlots(facts)
      .filter((s) => Date.parse(s.startsAt) > now && Date.parse(s.startsAt) >= start && Date.parse(s.startsAt) < end && !bookingHoldingSlot(s.id))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  })
}

export function toPublicReview(r: MockReview): PublicReview {
  const hidden = r.commentHiddenAt !== undefined
  return {
    id: r.id,
    rating: r.rating,
    comment: hidden ? undefined : r.comment,
    commentHidden: hidden,
    reply: r.reply,
    specialty: { id: r.specialtyId, name: r.specialtyName },
    method: r.method,
    consultedMonth: r.consultedMonth,
    createdOn: r.createdAt.slice(0, 10),
  }
}

export function listProfessionalReviews(professionalId: string, query: { specialtyId?: string; limit?: number; cursor?: string } = {}): Promise<PublicReviewPage> {
  return respond(() => {
    if (!professionalApproved(professionalId)) throw new AppError('NOT_FOUND')
    const all = reviewsOf(professionalId, query.specialtyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPublicReview)
    const page = pageOf(all, query.limit, query.cursor)
    return { summary: reviewSummaryOf(professionalId, query.specialtyId), ...page }
  })
}

// ───── Marcações da família (UC-MKT-27..29) ─────

export function createBooking(familyId: string, userId: string, memberId: string, input: CreateBookingInput): Promise<FamilyBooking> {
  return respond(() => {
    requireBooking(familyId, userId, memberId)
    const label = plainText(input.participantLabel, PARTICIPANT_LABEL_MAX, { required: true })
    if (label === null) throw new AppError('VALIDATION_ERROR')
    if (input.clientRequestId) {
      const existing = consultationsDb.bookings.find((b) => b.memberId === memberId && b.clientRequestId === input.clientRequestId)
      if (existing) return toFamilyBooking(existing, false)
    }
    const offer = [...marketplaceDb.catalogExtras, ...professionalDb.professionals].flatMap((p) => p.offers.map((o) => ({ professionalId: p.id, offerId: o.id }))).find((x) => x.offerId === input.offerId)
    if (!offer || !professionalApproved(offer.professionalId)) throw new AppError('NOT_FOUND')
    const facts = offerFacts(offer.professionalId, input.offerId)
    if (!facts) throw new AppError('NOT_FOUND')
    const slot = offerSlots(facts).find((s) => s.id === input.slotId)
    if (!slot) throw new AppError('NOT_FOUND')
    // O guarda corre depois dos factos: precisa do profissional (OP-113).
    guardSelfDealing(userId, offer.professionalId)
    const startsMs = Date.parse(slot.startsAt)
    const now = Date.now()
    if (startsMs < now + MIN_LEAD_MS || startsMs > now + MAX_LEAD_MS) throw new AppError('VALIDATION_ERROR')
    if (bookingHoldingSlot(slot.id)) throw new AppError('SLOT_UNAVAILABLE')
    const active = consultationsDb.bookings.filter((b) => b.memberId === memberId && isActive(b))
    if (active.some((b) => Date.parse(b.startsAt) < Date.parse(slot.endsAt) && startsMs < Date.parse(b.endsAt))) throw new AppError('CONFLICT')
    if (active.length >= MAX_ACTIVE_PER_MEMBER) throw new AppError('LIMIT_EXCEEDED')
    const created = new Date().toISOString()
    const booking: MockBooking = {
      id: consId('bkg'),
      familyId,
      memberId,
      professionalId: offer.professionalId,
      offerId: input.offerId,
      slotId: slot.id,
      participantLabel: label,
      offer: { specialtyId: facts.offer.specialtyId, specialtyName: facts.specialtyName, category: facts.category, method: facts.offer.method, durationMinutes: facts.offer.durationMinutes },
      priceKz: facts.offer.priceKz,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: 'REQUESTED',
      paymentStatus: facts.offer.priceKz === 0 ? 'NOT_REQUIRED' : 'AWAITING_PROOF',
      clientRequestId: input.clientRequestId,
      createdAt: created,
      updatedAt: created,
    }
    consultationsDb.bookings.push(booking)
    return toFamilyBooking(booking, false)
  })
}

export function listFamilyBookings(familyId: string, userId: string, memberId: string, query: { status?: BookingStatus; limit?: number; cursor?: string } = {}): Promise<Page<FamilyBooking>> {
  return respond(() => {
    requireBooking(familyId, userId, memberId)
    const all = consultationsDb.bookings
      .filter((b) => b.familyId === familyId && b.memberId === memberId && (!query.status || b.status === query.status))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .map((b) => toFamilyBooking(b, false))
    return pageOf(all, query.limit, query.cursor)
  })
}

export function getFamilyBooking(familyId: string, userId: string, memberId: string, bookingId: string): Promise<FamilyBooking> {
  return respond(() => toFamilyBooking(ownBooking(familyId, userId, memberId, bookingId), true))
}

export function cancelFamilyBooking(familyId: string, userId: string, memberId: string, bookingId: string, note?: string): Promise<FamilyBooking> {
  return respond(() => {
    const booking = ownBooking(familyId, userId, memberId, bookingId)
    const text = note === undefined || note.trim() === '' ? undefined : plainText(note, NOTE_MAX)
    if (text === null) throw new AppError('VALIDATION_ERROR')
    if (!isActive(booking) || Date.now() >= Date.parse(booking.startsAt)) throw new AppError('INVALID_STATE_TRANSITION')
    const now = new Date().toISOString()
    Object.assign(booking, { status: 'CANCELLED', cancelledBy: 'FAMILY', cancelledAt: now, statusReason: text, updatedAt: now })
    syncAppointment(booking)
    return toFamilyBooking(booking, true)
  })
}

// ───── Comprovativos (UC-MKT-35/37) ─────

function ownProof(familyId: string, userId: string, memberId: string, bookingId: string, proofId: string) {
  const booking = ownBooking(familyId, userId, memberId, bookingId)
  const proof = consultationsDb.proofs.find((p) => p.id === proofId && p.bookingId === booking.id)
  if (!proof) throw new AppError('NOT_FOUND')
  return { booking, proof }
}

export function listFamilyPaymentProofs(familyId: string, userId: string, memberId: string, bookingId: string): Promise<PaymentProof[]> {
  return respond(() => {
    const booking = ownBooking(familyId, userId, memberId, bookingId)
    settleScans(booking.id)
    return proofsOf(booking.id).map(toProof)
  })
}

export function uploadPaymentProof(familyId: string, userId: string, memberId: string, bookingId: string, file: File): Promise<PaymentProof> {
  return respond(() => {
    const booking = ownBooking(familyId, userId, memberId, bookingId)
    const fileError = proofFileError(file)
    if (fileError) throw new AppError(fileError)
    if (file.size < 1) throw new AppError('VALIDATION_ERROR')
    if (!payable(booking) || (booking.paymentStatus !== 'AWAITING_PROOF' && booking.paymentStatus !== 'REJECTED')) {
      // Preço 0, marcação por confirmar/terminada ou pagamento já em curso/satisfeito.
      if (booking.paymentStatus === 'PROOF_SUBMITTED' || booking.paymentStatus === 'DISPUTED') throw new AppError('CONFLICT')
      throw new AppError('INVALID_STATE_TRANSITION')
    }
    if (proofsOf(booking.id).length >= MAX_PROOFS) throw new AppError('LIMIT_EXCEEDED')
    const proof: MockProof = {
      id: consId('prf'),
      bookingId: booking.id,
      status: 'SUBMITTED',
      scanStatus: 'PENDING',
      contentType: file.type as MockProof['contentType'],
      sizeBytes: Math.min(file.size, PROOF_MAX_BYTES),
      fileName: file.name,
      purged: false,
      createdAt: new Date().toISOString(),
    }
    consultationsDb.proofs.push(proof)
    consultationsDb.proofFiles.set(proof.id, new Blob([`Comprovativo simulado ${proof.id}`], { type: proof.contentType }))
    booking.paymentStatus = 'PROOF_SUBMITTED'
    booking.updatedAt = proof.createdAt
    return toProof(proof)
  })
}

export function downloadFamilyPaymentProof(familyId: string, userId: string, memberId: string, bookingId: string, proofId: string): Promise<Blob> {
  return respondBlob(() => {
    const { booking, proof } = ownProof(familyId, userId, memberId, bookingId, proofId)
    settleScans(booking.id)
    const file = consultationsDb.proofFiles.get(proof.id)
    if (proof.scanStatus !== 'CLEAN' || proof.purged || !file) throw new AppError('DOCUMENT_NOT_AVAILABLE')
    return file
  })
}

export function disputePaymentProof(familyId: string, userId: string, memberId: string, bookingId: string, proofId: string, note?: string): Promise<PaymentProof> {
  return respond(() => {
    const { booking, proof } = ownProof(familyId, userId, memberId, bookingId, proofId)
    const text = note === undefined || note.trim() === '' ? undefined : plainText(note, NOTE_MAX)
    if (text === null) throw new AppError('VALIDATION_ERROR')
    if (proof.status !== 'REJECTED' || booking.paymentStatus !== 'REJECTED' || ['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(booking.status)) throw new AppError('INVALID_STATE_TRANSITION')
    const now = new Date().toISOString()
    Object.assign(proof, { status: 'DISPUTED', disputeNote: text, disputedAt: now })
    Object.assign(booking, { paymentStatus: 'DISPUTED', updatedAt: now })
    return toProof(proof)
  })
}

// ───── Avaliação própria (UC-MKT-39) ─────

function toFamilyReview(r: MockReview): FamilyReview {
  return {
    bookingId: r.bookingId,
    rating: r.rating,
    comment: r.comment,
    commentHidden: r.commentHiddenAt !== undefined,
    reply: r.reply,
    consultedMonth: r.consultedMonth,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    editableUntil: new Date(Date.parse(r.createdAt) + REVIEW_EDIT_MS).toISOString(),
  }
}

export function getFamilyBookingReview(familyId: string, userId: string, memberId: string, bookingId: string): Promise<FamilyReview> {
  return respond(() => {
    const booking = ownBooking(familyId, userId, memberId, bookingId)
    const review = reviewOfBooking(booking.id)
    if (!review) throw new AppError('NOT_FOUND')
    return toFamilyReview(review)
  })
}

/** Cria (`created`) ou edita a avaliação da marcação; só quem consultou, até 30 dias e editável durante 7 (BR-MKT-59). */
export function putFamilyBookingReview(familyId: string, userId: string, memberId: string, bookingId: string, input: ReviewInput): Promise<{ review: FamilyReview; created: boolean }> {
  return respond(() => {
    const booking = ownBooking(familyId, userId, memberId, bookingId)
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new AppError('VALIDATION_ERROR')
    const comment = input.comment === undefined || input.comment.trim() === '' ? undefined : plainText(input.comment, REVIEW_COMMENT_MAX)
    if (comment === null) throw new AppError('VALIDATION_ERROR')
    guardSelfDealing(userId, booking.professionalId)
    const existing = reviewOfBooking(booking.id)
    const now = Date.now()
    if (existing) {
      if (now > Date.parse(existing.createdAt) + REVIEW_EDIT_MS) throw new AppError('REVIEW_NOT_ALLOWED')
      Object.assign(existing, { rating: input.rating, comment, updatedAt: new Date(now).toISOString() })
      return { review: toFamilyReview(existing), created: false }
    }
    if (!reviewWindowOpen(booking, now)) throw new AppError('REVIEW_NOT_ALLOWED')
    const created = new Date(now).toISOString()
    const review: MockReview = {
      id: consId('rev'),
      bookingId: booking.id,
      professionalId: booking.professionalId,
      specialtyId: booking.offer.specialtyId,
      specialtyName: booking.offer.specialtyName,
      method: booking.offer.method,
      rating: input.rating,
      comment,
      consultedMonth: `${booking.startsAt.slice(0, 7)}-01`,
      createdAt: created,
      updatedAt: created,
    }
    consultationsDb.reviews.push(review)
    return { review: toFamilyReview(review), created: true }
  })
}
