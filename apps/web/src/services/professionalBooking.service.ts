import * as mock from '@/mocks/handlers/professionalBookings'
import { hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined, professionalApiFetch, professionalApiFetchBlob } from '@/lib/professionalApiClient'
import type { PaymentProof, ProfessionalBooking, ProfessionalBookingQuery, ProfessionalReview, ReviewReportInput, ReviewReportReceipt } from '@/types/consultations'
import type { Page } from '@/types/marketplace'

/**
 * Marcações, comprovativos e avaliações do profissional (`/professional-portal/{bookings,reviews}*`, MK3).
 * Sessão própria da conta de profissional; a vista da família é só o `participantLabel` (BR-MKT-63). Em
 * `SUSPENDED`/`REJECTED` a leitura continua e confirmar, recusar, concluir, decidir, responder e denunciar
 * dão `PROFESSIONAL_LOCKED`.
 */
const call = <T>(path: string, options?: { method?: string; body?: unknown }) => professionalApiFetch<unknown>(path, options).then((data) => nullsToUndefined<T>(data))
const id = encodeURIComponent
const pageOf = <T>(page: Page<T>): Page<T> => ({ items: page.items, nextCursor: page.nextCursor ?? null })

const mockImpl = {
  list: (query?: ProfessionalBookingQuery): Promise<Page<ProfessionalBooking>> => mock.listProfessionalBookings(query),
  get: (bookingId: string): Promise<ProfessionalBooking> => mock.getProfessionalBooking(bookingId),
  confirm: (bookingId: string, meetingInfo?: string): Promise<ProfessionalBooking> => mock.confirmBooking(bookingId, meetingInfo),
  reject: (bookingId: string, reason: string): Promise<ProfessionalBooking> => mock.rejectBooking(bookingId, reason),
  cancel: (bookingId: string, reason: string): Promise<ProfessionalBooking> => mock.cancelProfessionalBooking(bookingId, reason),
  complete: (bookingId: string): Promise<ProfessionalBooking> => mock.completeBooking(bookingId),
  noShow: (bookingId: string): Promise<ProfessionalBooking> => mock.markBookingNoShow(bookingId),
  downloadProof: (bookingId: string, proofId: string): Promise<Blob> => mock.downloadProfessionalPaymentProof(bookingId, proofId),
  decideProof: (bookingId: string, proofId: string, input: { decision: 'CONFIRM' | 'REJECT'; reason?: string }): Promise<PaymentProof> => mock.decidePaymentProof(bookingId, proofId, input),
  reviews: (query?: { unanswered?: boolean; cursor?: string }): Promise<Page<ProfessionalReview>> => mock.listProfessionalReviewsOwn(query),
  reply: (reviewId: string, text: string): Promise<ProfessionalReview> => mock.replyToReview(reviewId, text),
  reportReview: (reviewId: string, input: ReviewReportInput): Promise<ReviewReportReceipt> => mock.reportReview(reviewId, input),
}

const apiImpl: typeof mockImpl = {
  list(query = {}) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value) search.set(key, value)
    const text = search.toString()
    return call<Page<ProfessionalBooking>>(`/bookings${text ? `?${text}` : ''}`).then(pageOf)
  },
  get: (bookingId) => call<ProfessionalBooking>(`/bookings/${id(bookingId)}`),
  confirm: (bookingId, meetingInfo) => call<ProfessionalBooking>(`/bookings/${id(bookingId)}/confirm`, { method: 'POST', body: meetingInfo ? { meetingInfo } : {} }),
  reject: (bookingId, reason) => call<ProfessionalBooking>(`/bookings/${id(bookingId)}/reject`, { method: 'POST', body: { reason } }),
  cancel: (bookingId, reason) => call<ProfessionalBooking>(`/bookings/${id(bookingId)}/cancel`, { method: 'POST', body: { reason } }),
  complete: (bookingId) => call<ProfessionalBooking>(`/bookings/${id(bookingId)}/complete`, { method: 'POST' }),
  noShow: (bookingId) => call<ProfessionalBooking>(`/bookings/${id(bookingId)}/no-show`, { method: 'POST' }),
  downloadProof: (bookingId, proofId) => professionalApiFetchBlob(`/bookings/${id(bookingId)}/payment-proofs/${id(proofId)}/file`),
  decideProof: (bookingId, proofId, input) => call<PaymentProof>(`/bookings/${id(bookingId)}/payment-proofs/${id(proofId)}/decision`, { method: 'POST', body: input }),
  reviews(query = {}) {
    const search = new URLSearchParams()
    if (query.unanswered) search.set('unanswered', 'true')
    if (query.cursor) search.set('cursor', query.cursor)
    const text = search.toString()
    return call<Page<ProfessionalReview>>(`/reviews${text ? `?${text}` : ''}`).then(pageOf)
  },
  reply: (reviewId, text) => call<ProfessionalReview>(`/reviews/${id(reviewId)}/reply`, { method: 'POST', body: { text } }),
  reportReview: (reviewId, input) => call<ReviewReportReceipt>(`/reviews/${id(reviewId)}/reports`, { method: 'POST', body: input }),
}

export const professionalBookingService = hasApiBackend() ? apiImpl : mockImpl
