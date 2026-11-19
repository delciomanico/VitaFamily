import { AppError } from '@/lib/errors'
import { MEETING_INFO_MAX, NOTE_MAX, REPLY_MAX, plainText } from '@/lib/consultations'
import type { Page } from '@/types/marketplace'
import type { PaymentProof, ProfessionalBooking, ProfessionalBookingQuery, ProfessionalReview, ReviewReportInput, ReviewReportReceipt } from '@/types/consultations'
import { ACTIVE_STATUSES, consId, consultationsDb, type MockBooking, type MockReview } from '../consultationsDb'
import { db } from '../db'
import { respond, respondBlob } from '../respond'
import { isActive, proofsOf, settleScans, syncAppointment, toProof, toPublicReview } from './consultations'
import { marketplaceDb } from '../marketplaceDb'
import { requireProfessional } from './professionalPortal'

/*
 * Portal do profissional, marcações e avaliações (MK3: `/professional-portal/bookings*` e `/reviews*`). O
 * profissional resolve-se pela sessão e só vê o `participantLabel`: nunca ids de família, membro nem
 * utilizador (BR-MKT-63). Ler funciona em qualquer estado de validação; escrever exige `APPROVED`
 * (`PROFESSIONAL_LOCKED`). Marcação ou avaliação alheia ⇒ `NOT_FOUND` idêntico.
 */

const PAGE_SIZE = 25
const DAY = 86_400_000
const REQUEST_EXPIRY_MS = 48 * 3_600_000
const MAX_PROOF_NOTE = NOTE_MAX

function pageOf<T>(all: T[], limit: number | undefined, cursor: string | undefined): Page<T> {
  const size = Math.min(Math.max(limit ?? PAGE_SIZE, 1), 100)
  const start = cursor ? Number(cursor) : 0
  if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
  return { items: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null }
}

function requireApproved() {
  const record = requireProfessional()
  if (record.validationStatus !== 'APPROVED') throw new AppError('PROFESSIONAL_LOCKED')
  return record
}

function ownBooking(professionalId: string, bookingId: string): MockBooking {
  const booking = consultationsDb.bookings.find((b) => b.id === bookingId && b.professionalId === professionalId)
  if (!booking) throw new AppError('NOT_FOUND')
  return booking
}

function toProfessionalBooking(b: MockBooking): ProfessionalBooking {
  settleScans(b.id)
  const proof = proofsOf(b.id)[0]
  const conversation = marketplaceDb.conversations.find((c) => c.familyId === b.familyId && c.memberId === b.memberId && c.professionalId === b.professionalId)
  return {
    id: b.id,
    participantLabel: b.participantLabel,
    offer: b.offer,
    priceKz: b.priceKz,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    status: b.status,
    paymentStatus: b.paymentStatus,
    statusReason: b.statusReason,
    cancelledBy: b.cancelledBy,
    systemReason: b.systemReason,
    cancelledLate: b.cancelledBy === 'FAMILY' && b.cancelledAt !== undefined && Date.parse(b.startsAt) - Date.parse(b.cancelledAt) < DAY,
    meetingInfo: b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? b.meetingInfo : undefined,
    conversationId: conversation?.id,
    proof: proof ? toProof(proof) : undefined,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }
}

function touch(b: MockBooking) {
  b.updatedAt = new Date().toISOString()
}

// ───── Marcações (UC-MKT-30..33) ─────

export function listProfessionalBookings(query: ProfessionalBookingQuery = {}): Promise<Page<ProfessionalBooking>> {
  return respond(() => {
    const record = requireProfessional()
    const from = query.from ? Date.parse(query.from) : undefined
    const to = query.to ? Date.parse(query.to) : undefined
    if ((from !== undefined && Number.isNaN(from)) || (to !== undefined && Number.isNaN(to)) || (from !== undefined && to !== undefined && to <= from)) throw new AppError('VALIDATION_ERROR')
    const now = Date.now()
    // Omissão: `REQUESTED` e `CONFIRMED` futuras, as mais próximas primeiro.
    const byDefault = !query.status && from === undefined && to === undefined
    const rows = consultationsDb.bookings
      .filter((b) => b.professionalId === record.id)
      .filter((b) => (byDefault ? ACTIVE_STATUSES.includes(b.status) && Date.parse(b.startsAt) >= now : !query.status || b.status === query.status))
      .filter((b) => (from === undefined || Date.parse(b.startsAt) >= from) && (to === undefined || Date.parse(b.startsAt) < to))
      .sort((a, b) => (byDefault ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt)))
    return pageOf(rows.map(toProfessionalBooking), undefined, query.cursor)
  })
}

export function getProfessionalBooking(bookingId: string): Promise<ProfessionalBooking> {
  return respond(() => toProfessionalBooking(ownBooking(requireProfessional().id, bookingId)))
}

/** Pedido `REQUESTED` caducado (48 h sem resposta ou hora passada) já não se confirma nem recusa (BR-MKT-54). */
function expired(b: MockBooking): boolean {
  return Date.now() - Date.parse(b.createdAt) >= REQUEST_EXPIRY_MS || Date.parse(b.startsAt) <= Date.now()
}

export function confirmBooking(bookingId: string, meetingInfo?: string): Promise<ProfessionalBooking> {
  return respond(() => {
    const record = requireApproved()
    const booking = ownBooking(record.id, bookingId)
    const info = meetingInfo === undefined || meetingInfo.trim() === '' ? undefined : plainText(meetingInfo, MEETING_INFO_MAX)
    if (info === null) throw new AppError('VALIDATION_ERROR')
    if (booking.status !== 'REQUESTED' || expired(booking)) throw new AppError('INVALID_STATE_TRANSITION')
    if ((booking.offer.method === 'VIDEO' || booking.offer.method === 'PHONE') && !info) throw new AppError('VALIDATION_ERROR')
    booking.status = 'CONFIRMED'
    booking.meetingInfo = info
    touch(booking)
    // Cria a consulta no registo do membro, gerida pela marcação (BR-MKT-55).
    const appointment = {
      id: consId('apt'),
      familyId: booking.familyId,
      memberId: booking.memberId,
      scheduledAt: booking.startsAt,
      status: 'SCHEDULED' as const,
      specialty: booking.offer.specialtyName,
      professionalName: record.displayName,
      bookingId: booking.id,
    }
    db.appointments.push(appointment)
    booking.appointmentId = appointment.id
    return toProfessionalBooking(booking)
  })
}

export function rejectBooking(bookingId: string, reason: string): Promise<ProfessionalBooking> {
  return respond(() => {
    const record = requireApproved()
    const booking = ownBooking(record.id, bookingId)
    const text = plainText(reason, NOTE_MAX, { required: true })
    if (text === null) throw new AppError('VALIDATION_ERROR')
    if (booking.status !== 'REQUESTED' || expired(booking)) throw new AppError('INVALID_STATE_TRANSITION')
    Object.assign(booking, { status: 'REJECTED', statusReason: text })
    touch(booking)
    return toProfessionalBooking(booking)
  })
}

export function cancelProfessionalBooking(bookingId: string, reason: string): Promise<ProfessionalBooking> {
  return respond(() => {
    const record = requireApproved()
    const booking = ownBooking(record.id, bookingId)
    const text = plainText(reason, NOTE_MAX, { required: true })
    if (text === null) throw new AppError('VALIDATION_ERROR')
    if (!isActive(booking) || Date.now() >= Date.parse(booking.startsAt)) throw new AppError('INVALID_STATE_TRANSITION')
    Object.assign(booking, { status: 'CANCELLED', cancelledBy: 'PROFESSIONAL', cancelledAt: new Date().toISOString(), statusReason: text })
    touch(booking)
    syncAppointment(booking)
    return toProfessionalBooking(booking)
  })
}

function finish(bookingId: string, outcome: 'COMPLETED' | 'NO_SHOW'): Promise<ProfessionalBooking> {
  return respond(() => {
    const record = requireApproved()
    const booking = ownBooking(record.id, bookingId)
    if (booking.status !== 'CONFIRMED' || Date.now() < Date.parse(booking.startsAt)) throw new AppError('INVALID_STATE_TRANSITION')
    booking.status = outcome
    if (outcome === 'COMPLETED') booking.completedAt = new Date().toISOString()
    touch(booking)
    syncAppointment(booking)
    return toProfessionalBooking(booking)
  })
}

export const completeBooking = (bookingId: string) => finish(bookingId, 'COMPLETED')
export const markBookingNoShow = (bookingId: string) => finish(bookingId, 'NO_SHOW')

// ───── Comprovativos (UC-MKT-36) ─────

function ownProof(professionalId: string, bookingId: string, proofId: string) {
  const booking = ownBooking(professionalId, bookingId)
  const proof = consultationsDb.proofs.find((p) => p.id === proofId && p.bookingId === booking.id)
  if (!proof) throw new AppError('NOT_FOUND')
  return { booking, proof }
}

export function downloadProfessionalPaymentProof(bookingId: string, proofId: string): Promise<Blob> {
  return respondBlob(() => {
    const record = requireProfessional()
    const { booking, proof } = ownProof(record.id, bookingId, proofId)
    settleScans(booking.id)
    const file = consultationsDb.proofFiles.get(proof.id)
    if (proof.scanStatus !== 'CLEAN' || proof.purged || !file) throw new AppError('DOCUMENT_NOT_AVAILABLE')
    return file
  })
}

export function decidePaymentProof(bookingId: string, proofId: string, input: { decision: 'CONFIRM' | 'REJECT'; reason?: string }): Promise<PaymentProof> {
  return respond(() => {
    const record = requireApproved()
    const { booking, proof } = ownProof(record.id, bookingId, proofId)
    settleScans(booking.id)
    const reason = input.reason === undefined ? undefined : plainText(input.reason, MAX_PROOF_NOTE, { required: input.decision === 'REJECT' })
    if (reason === null || (input.decision === 'REJECT' && !reason)) throw new AppError('VALIDATION_ERROR')
    if (proof.scanStatus !== 'CLEAN') throw new AppError('DOCUMENT_NOT_AVAILABLE')
    if (proof.status !== 'SUBMITTED' || ['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(booking.status)) throw new AppError('INVALID_STATE_TRANSITION')
    const now = new Date().toISOString()
    if (input.decision === 'CONFIRM') {
      Object.assign(proof, { status: 'CONFIRMED', decidedAt: now })
      booking.paymentStatus = 'CONFIRMED'
    } else {
      Object.assign(proof, { status: 'REJECTED', decidedAt: now, decisionReason: reason })
      booking.paymentStatus = 'REJECTED'
    }
    touch(booking)
    return toProof(proof)
  })
}

// ───── Avaliações recebidas (UC-MKT-41/42) ─────

const toProfessionalReview = (r: MockReview): ProfessionalReview => ({
  ...toPublicReview(r),
  reported: consultationsDb.reviewReports.some((x) => x.reviewId === r.id),
})

function ownReview(professionalId: string, reviewId: string): MockReview {
  const review = consultationsDb.reviews.find((r) => r.id === reviewId && r.professionalId === professionalId)
  if (!review) throw new AppError('NOT_FOUND')
  return review
}

export function listProfessionalReviewsOwn(query: { unanswered?: boolean; limit?: number; cursor?: string } = {}): Promise<Page<ProfessionalReview>> {
  return respond(() => {
    const record = requireProfessional()
    const rows = consultationsDb.reviews
      .filter((r) => r.professionalId === record.id && (!query.unanswered || !r.reply))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toProfessionalReview)
    return pageOf(rows, query.limit, query.cursor)
  })
}

export function replyToReview(reviewId: string, text: string): Promise<ProfessionalReview> {
  return respond(() => {
    const record = requireApproved()
    const review = ownReview(record.id, reviewId)
    const reply = plainText(text, REPLY_MAX, { required: true })
    if (reply === null) throw new AppError('VALIDATION_ERROR')
    if (review.reply) throw new AppError('CONFLICT')
    review.reply = { text: reply, repliedAt: new Date().toISOString() }
    return toProfessionalReview(review)
  })
}

export function reportReview(reviewId: string, input: ReviewReportInput): Promise<ReviewReportReceipt> {
  return respond(() => {
    const record = requireApproved()
    const review = ownReview(record.id, reviewId)
    const note = input.note === undefined || input.note.trim() === '' ? undefined : plainText(input.note, NOTE_MAX)
    if (note === null || !['ABUSE', 'PERSONAL_DATA', 'OFF_TOPIC', 'OTHER'].includes(input.reason)) throw new AppError('VALIDATION_ERROR')
    const receipt = (r: (typeof consultationsDb.reviewReports)[number]): ReviewReportReceipt => ({ id: r.id, reviewId: r.reviewId, status: r.status, reason: r.reason, createdAt: r.createdAt })
    // Já denunciada antes ⇒ devolve a existente.
    const existing = consultationsDb.reviewReports.find((r) => r.reviewId === review.id)
    if (existing) return receipt(existing)
    const report = { id: consId('rrp'), reviewId: review.id, reason: input.reason, note, status: 'OPEN' as const, createdAt: new Date().toISOString() }
    consultationsDb.reviewReports.push(report)
    return receipt(report)
  })
}
