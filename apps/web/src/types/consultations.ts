/**
 * Tipos de MK3 (marcação, comprovativo de pagamento e avaliações verificadas): `/marketplace/professionals/{id}/{slots,reviews}`,
 * `/families/{f}/members/{m}/bookings*`, `/professional-portal/{bookings,reviews}*` e `/admin/{payment-disputes,review-reports}*`.
 * Alinhados com `docs/05-api/openapi.yaml`; a API devolve `null` e a UI usa ausente (`undefined`).
 * Texto livre (motivos, notas, ligação, comentários) é dado potencialmente sensível (BR-MKT-63): nunca vai para logs.
 */
import type { OfferMethod, SpecialtyCategory } from './professional'
import type { ReviewSummary } from './marketplace'

export type BookingStatus = 'REQUESTED' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'
export type BookingPaymentStatus = 'NOT_REQUIRED' | 'AWAITING_PROOF' | 'PROOF_SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'DISPUTED'
export type BookingCancelledBy = 'FAMILY' | 'PROFESSIONAL' | 'SYSTEM'
export type BookingSystemReason = 'REQUEST_EXPIRED' | 'PROFESSIONAL_UNAVAILABLE'
export type PaymentProofStatus = 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'DISPUTED' | 'REJECTION_UPHELD'
export type ProofScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED'
export type ProofContentType = 'application/pdf' | 'image/jpeg' | 'image/png'

export interface BookingProfessional {
  id: string
  displayName: string
  city?: string
}

/** Cópia da oferta à data da marcação (BR-MKT-51). */
export interface BookingOfferSummary {
  specialtyId: string
  specialtyName: string
  category: SpecialtyCategory
  method: OfferMethod
  durationMinutes: number
}

export interface BookableSlot {
  id: string
  offerId: string
  startsAt: string
  endsAt: string
}

export interface CreateBookingInput {
  offerId: string
  slotId: string
  participantLabel: string
  clientRequestId?: string
}

export interface FamilyBooking {
  id: string
  memberId: string
  professional: BookingProfessional
  offer: BookingOfferSummary
  participantLabel: string
  priceKz: number
  startsAt: string
  endsAt: string
  status: BookingStatus
  paymentStatus: BookingPaymentStatus
  statusReason?: string
  cancelledBy?: BookingCancelledBy
  systemReason?: BookingSystemReason
  /** Derivado: cancelada pela família com menos de 24 h até à hora (só informativo). */
  cancelledLate: boolean
  /** Só com `CONFIRMED`/`COMPLETED`. */
  meetingInfo?: string
  /** Só no detalhe, com `CONFIRMED`/`COMPLETED` e preço > 0 (BR-MKT-56). */
  paymentInstructions?: string
  processId?: string
  appointmentId?: string
  conversationId?: string
  /** MK4 (BR-MKT-81): receita digital emitida para esta marcação; só existe com a receita digital ligada. */
  prescriptionId?: string
  canCancel: boolean
  canSendProof: boolean
  canReview: boolean
  hasReview: boolean
  createdAt: string
  updatedAt: string
}

export interface PaymentProof {
  id: string
  bookingId: string
  status: PaymentProofStatus
  scanStatus: ProofScanStatus
  contentType: ProofContentType
  sizeBytes: number
  decisionReason?: string
  disputeNote?: string
  disputeDecision?: 'CONFIRM_PAYMENT' | 'UPHOLD_REJECTION'
  decidedAt?: string
  disputedAt?: string
  /** Ficheiro apagado pela retenção (BR-MKT-64). */
  purged: boolean
  createdAt: string
}

/** Vista do profissional: nunca ids de família, membro ou utilizador (BR-MKT-63); só o `participantLabel`. */
export interface ProfessionalBooking {
  id: string
  participantLabel: string
  offer: BookingOfferSummary
  priceKz: number
  startsAt: string
  endsAt: string
  status: BookingStatus
  paymentStatus: BookingPaymentStatus
  statusReason?: string
  cancelledBy?: BookingCancelledBy
  systemReason?: BookingSystemReason
  cancelledLate: boolean
  meetingInfo?: string
  conversationId?: string
  /** MK4 (BR-MKT-80): derivado; ausente (= falso) com a receita digital desligada. */
  canPrescribe?: boolean
  /** MK4: já emitiu receita nesta marcação. */
  hasPrescription?: boolean
  /** Comprovativo em curso ou o mais recente; ausente quando não há. */
  proof?: PaymentProof
  createdAt: string
  updatedAt: string
}

export interface ProfessionalBookingQuery {
  status?: BookingStatus
  from?: string
  to?: string
  cursor?: string
}

// ───── Avaliações ─────

export interface ReviewInput {
  rating: number
  comment?: string
}

export interface ReviewReply {
  text: string
  repliedAt: string
}

/** A avaliação própria da família (BR-MKT-59): editável até `editableUntil`. */
export interface FamilyReview {
  bookingId: string
  rating: number
  comment?: string
  commentHidden: boolean
  reply?: ReviewReply
  /** Primeiro dia do mês da consulta (AAAA-MM-DD). */
  consultedMonth: string
  createdAt: string
  updatedAt: string
  editableUntil: string
}

/** Avaliação anónima: nunca nome, rótulo, ids nem a data exata (BR-MKT-59/63). */
export interface PublicReview {
  id: string
  rating: number
  /** Ausente quando `commentHidden`. */
  comment?: string
  commentHidden: boolean
  reply?: ReviewReply
  specialty: { id: string; name: string }
  method: OfferMethod
  consultedMonth: string
  createdOn: string
}

export interface PublicReviewPage {
  summary: ReviewSummary
  items: PublicReview[]
  nextCursor: string | null
}

export interface ProfessionalReview extends PublicReview {
  /** O profissional já denunciou esta avaliação. */
  reported: boolean
}

export type ReviewReportReason = 'ABUSE' | 'PERSONAL_DATA' | 'OFF_TOPIC' | 'OTHER'

export interface ReviewReportInput {
  reason: ReviewReportReason
  note?: string
}

export interface ReviewReportReceipt {
  id: string
  reviewId: string
  status: 'OPEN' | 'DECIDED'
  reason: ReviewReportReason
  createdAt: string
}

// ───── Administração ─────

export type PaymentDisputeDecision = 'CONFIRM_PAYMENT' | 'UPHOLD_REJECTION'

export interface AdminPaymentDisputeItem {
  proofId: string
  status: 'DISPUTED' | 'DECIDED'
  professional: BookingProfessional
  specialtyName: string
  startsAt: string
  priceKz: number
  disputedAt: string
}

/** BR-MKT-58/63: só a marcação e o comprovativo; nunca família, membro, rótulo nem conversas. */
export interface AdminPaymentDisputeDetail {
  proofId: string
  status: 'DISPUTED' | 'DECIDED'
  booking: {
    professional: BookingProfessional
    specialtyName: string
    method: OfferMethod
    durationMinutes: number
    startsAt: string
    priceKz: number
    status: BookingStatus
    paymentStatus: BookingPaymentStatus
  }
  proof: { contentType: ProofContentType; sizeBytes: number; scanStatus: ProofScanStatus; submittedAt: string }
  professionalReason?: string
  familyNote?: string
  disputedAt: string
  decision?: PaymentDisputeDecision
  decidedAt?: string
}

export type ReviewReportDecision = 'DISMISS' | 'HIDE_COMMENT'

export interface AdminReviewReportItem {
  id: string
  status: 'OPEN' | 'DECIDED'
  reason: ReviewReportReason
  professional: BookingProfessional
  rating: number
  createdAt: string
}

/** BR-MKT-60/63: só a avaliação denunciada; o admin vê o texto original mesmo se já estiver oculto. */
export interface AdminReviewReportDetail {
  id: string
  status: 'OPEN' | 'DECIDED'
  reason: ReviewReportReason
  note?: string
  professional: BookingProfessional
  review: {
    rating: number
    comment?: string
    commentHidden: boolean
    reply?: ReviewReply
    specialtyName: string
    method: OfferMethod
    consultedMonth: string
  }
  decision?: ReviewReportDecision
  decidedAt?: string
  createdAt: string
}
