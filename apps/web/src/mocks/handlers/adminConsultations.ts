import { AppError } from '@/lib/errors'
import type { Page } from '@/types/marketplace'
import type {
  AdminPaymentDisputeDetail,
  AdminPaymentDisputeItem,
  AdminReviewReportDetail,
  AdminReviewReportItem,
  PaymentDisputeDecision,
  ReviewReportDecision,
} from '@/types/consultations'
import { consultationsDb, type MockBooking, type MockProof } from '../consultationsDb'
import { respond, respondBlob } from '../respond'
import { publicProfessionalName } from './marketplace'

/*
 * Fila de disputas de pagamento e de denúncias de avaliações (MK3: `/admin/payment-disputes*` e
 * `/admin/review-reports*`, BR-MKT-58/60/63). O admin vê só o comprovativo e a marcação, ou só a avaliação
 * denunciada: nunca família, membro, rótulo, conversas nem outras avaliações. Cada abertura e cada
 * descarregamento são auditados no servidor.
 */

const PAGE_SIZE = 25
const FROZEN = ['CANCELLED', 'REJECTED', 'NO_SHOW']

function pageOf<T>(all: T[], limit: number | undefined, cursor: string | undefined): Page<T> {
  const size = Math.min(Math.max(limit ?? PAGE_SIZE, 1), 100)
  const start = cursor ? Number(cursor) : 0
  if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
  return { items: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null }
}

const professionalOf = (id: string) => publicProfessionalName(id) ?? { id, displayName: 'Profissional' }

/** Disputa: comprovativo que foi disputado, de uma marcação que não está cancelada/recusada/falta (OP-114). */
function disputeRecord(proofId: string): { proof: MockProof; booking: MockBooking } | undefined {
  const proof = consultationsDb.proofs.find((p) => p.id === proofId && p.disputedAt !== undefined)
  const booking = proof && consultationsDb.bookings.find((b) => b.id === proof.bookingId)
  return proof && booking ? { proof, booking } : undefined
}

const disputeStatus = (proof: MockProof): 'DISPUTED' | 'DECIDED' => (proof.status === 'DISPUTED' ? 'DISPUTED' : 'DECIDED')

// ───── Disputas de pagamento (UC-MKT-38) ─────

export function adminListPaymentDisputes(query: { status?: 'DISPUTED' | 'DECIDED'; limit?: number; cursor?: string } = {}): Promise<Page<AdminPaymentDisputeItem>> {
  return respond(() => {
    const status = query.status ?? 'DISPUTED'
    const rows = consultationsDb.proofs
      .map((proof) => disputeRecord(proof.id))
      .filter((r): r is { proof: MockProof; booking: MockBooking } => r !== undefined)
      .filter(({ proof, booking }) => disputeStatus(proof) === status && !FROZEN.includes(booking.status))
      .sort((a, b) => (a.proof.disputedAt ?? '').localeCompare(b.proof.disputedAt ?? ''))
      .map(
        ({ proof, booking }): AdminPaymentDisputeItem => ({
          proofId: proof.id,
          status: disputeStatus(proof),
          professional: professionalOf(booking.professionalId),
          specialtyName: booking.offer.specialtyName,
          startsAt: booking.startsAt,
          priceKz: booking.priceKz,
          disputedAt: proof.disputedAt as string,
        }),
      )
    return pageOf(rows, query.limit, query.cursor)
  })
}

export function adminGetPaymentDispute(proofId: string): Promise<AdminPaymentDisputeDetail> {
  return respond(() => {
    const record = disputeRecord(proofId)
    if (!record || FROZEN.includes(record.booking.status)) throw new AppError('NOT_FOUND')
    return disputeDetail(proofId)
  })
}

/** O admin só descarrega com o comprovativo `DISPUTED` (e a marcação ainda válida). */
export function adminDownloadPaymentProof(proofId: string): Promise<Blob> {
  return respondBlob(() => {
    const record = disputeRecord(proofId)
    if (!record) throw new AppError('NOT_FOUND')
    const file = consultationsDb.proofFiles.get(record.proof.id)
    if (record.proof.status !== 'DISPUTED' || FROZEN.includes(record.booking.status) || record.proof.scanStatus !== 'CLEAN' || record.proof.purged || !file) {
      throw new AppError('DOCUMENT_NOT_AVAILABLE')
    }
    return file
  })
}

export function adminDecidePaymentDispute(proofId: string, decision: PaymentDisputeDecision): Promise<AdminPaymentDisputeDetail> {
  return respond(() => {
    const record = disputeRecord(proofId)
    if (!record) throw new AppError('NOT_FOUND')
    const { proof, booking } = record
    if (proof.status !== 'DISPUTED' || FROZEN.includes(booking.status)) throw new AppError('INVALID_STATE_TRANSITION')
    const now = new Date().toISOString()
    proof.status = decision === 'CONFIRM_PAYMENT' ? 'CONFIRMED' : 'REJECTION_UPHELD'
    proof.disputeDecision = decision
    proof.decidedAt = now
    booking.paymentStatus = decision === 'CONFIRM_PAYMENT' ? 'CONFIRMED' : 'REJECTED'
    booking.updatedAt = now
    return disputeDetail(proofId)
  })
}

function disputeDetail(proofId: string): AdminPaymentDisputeDetail {
  const record = disputeRecord(proofId) as { proof: MockProof; booking: MockBooking }
  const { proof, booking } = record
  return {
    proofId: proof.id,
    status: disputeStatus(proof),
    booking: {
      professional: professionalOf(booking.professionalId),
      specialtyName: booking.offer.specialtyName,
      method: booking.offer.method,
      durationMinutes: booking.offer.durationMinutes,
      startsAt: booking.startsAt,
      priceKz: booking.priceKz,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
    },
    proof: { contentType: proof.contentType, sizeBytes: proof.sizeBytes, scanStatus: proof.scanStatus, submittedAt: proof.createdAt },
    professionalReason: proof.decisionReason,
    familyNote: proof.disputeNote,
    disputedAt: proof.disputedAt as string,
    decision: proof.disputeDecision,
    decidedAt: proof.disputeDecision ? proof.decidedAt : undefined,
  }
}

// ───── Denúncias de avaliações (UC-MKT-43) ─────

function reportRecord(reportId: string) {
  const report = consultationsDb.reviewReports.find((r) => r.id === reportId)
  const review = report && consultationsDb.reviews.find((r) => r.id === report.reviewId)
  if (!report || !review) throw new AppError('NOT_FOUND')
  return { report, review }
}

export function adminListReviewReports(query: { status?: 'OPEN' | 'DECIDED'; limit?: number; cursor?: string } = {}): Promise<Page<AdminReviewReportItem>> {
  return respond(() => {
    const status = query.status ?? 'OPEN'
    const rows = consultationsDb.reviewReports
      .filter((r) => r.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .flatMap((report): AdminReviewReportItem[] => {
        const review = consultationsDb.reviews.find((r) => r.id === report.reviewId)
        return review ? [{ id: report.id, status: report.status, reason: report.reason, professional: professionalOf(review.professionalId), rating: review.rating, createdAt: report.createdAt }] : []
      })
    return pageOf(rows, query.limit, query.cursor)
  })
}

function reportDetail(reportId: string): AdminReviewReportDetail {
  const { report, review } = reportRecord(reportId)
  return {
    id: report.id,
    status: report.status,
    reason: report.reason,
    note: report.note,
    professional: professionalOf(review.professionalId),
    review: {
      rating: review.rating,
      // O admin vê o texto original mesmo se já estiver oculto.
      comment: review.comment,
      commentHidden: review.commentHiddenAt !== undefined,
      reply: review.reply,
      specialtyName: review.specialtyName,
      method: review.method,
      consultedMonth: review.consultedMonth,
    },
    decision: report.decision,
    decidedAt: report.decidedAt,
    createdAt: report.createdAt,
  }
}

export function adminGetReviewReport(reportId: string): Promise<AdminReviewReportDetail> {
  return respond(() => reportDetail(reportId))
}

export function adminDecideReviewReport(reportId: string, decision: ReviewReportDecision): Promise<AdminReviewReportDetail> {
  return respond(() => {
    const { report, review } = reportRecord(reportId)
    if (report.status !== 'OPEN') throw new AppError('INVALID_STATE_TRANSITION')
    const now = new Date().toISOString()
    Object.assign(report, { status: 'DECIDED', decision, decidedAt: now })
    // Oculta só o comentário: a nota continua a contar (BR-MKT-60).
    if (decision === 'HIDE_COMMENT') review.commentHiddenAt = now
    return reportDetail(reportId)
  })
}
