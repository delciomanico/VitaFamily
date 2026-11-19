import * as mock from '@/mocks/handlers/consultations'
import { apiFetch, apiFetchBlob, hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined } from '@/lib/professionalApiClient'
import type { BookingStatus, CreateBookingInput, FamilyBooking, FamilyReview, PaymentProof, ReviewInput } from '@/types/consultations'
import type { Page } from '@/types/marketplace'

/**
 * Marcações da família (`/families/{f}/members/{m}/bookings*`, MK3). Só o titular (`SELF`) e o tutor marcam em
 * nome do membro (ação `BOOK_PROFESSIONALS`). O pagamento é feito fora da aplicação: a Vita Family guarda só o
 * estado declarativo e o comprovativo (BR-MKT-56/57). Texto livre (notas, comentários) nunca vai para logs.
 */
const base = (familyId: string, memberId: string) => `/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberId)}/bookings`
const call = <T>(path: string, options?: { method?: string; body?: unknown }) => apiFetch<unknown>(path, options).then((data) => nullsToUndefined<T>(data))
const id = encodeURIComponent
const pageOf = <T>(page: Page<T>): Page<T> => ({ items: page.items, nextCursor: page.nextCursor ?? null })

const mockImpl = {
  list: (familyId: string, userId: string, memberId: string, status?: BookingStatus, cursor?: string): Promise<Page<FamilyBooking>> => mock.listFamilyBookings(familyId, userId, memberId, { status, cursor }),
  get: (familyId: string, userId: string, memberId: string, bookingId: string): Promise<FamilyBooking> => mock.getFamilyBooking(familyId, userId, memberId, bookingId),
  create: (familyId: string, userId: string, memberId: string, input: CreateBookingInput): Promise<FamilyBooking> => mock.createBooking(familyId, userId, memberId, input),
  cancel: (familyId: string, userId: string, memberId: string, bookingId: string, note?: string): Promise<FamilyBooking> => mock.cancelFamilyBooking(familyId, userId, memberId, bookingId, note),
  proofs: (familyId: string, userId: string, memberId: string, bookingId: string): Promise<PaymentProof[]> => mock.listFamilyPaymentProofs(familyId, userId, memberId, bookingId),
  uploadProof: (familyId: string, userId: string, memberId: string, bookingId: string, file: File): Promise<PaymentProof> => mock.uploadPaymentProof(familyId, userId, memberId, bookingId, file),
  downloadProof: (familyId: string, userId: string, memberId: string, bookingId: string, proofId: string): Promise<Blob> => mock.downloadFamilyPaymentProof(familyId, userId, memberId, bookingId, proofId),
  disputeProof: (familyId: string, userId: string, memberId: string, bookingId: string, proofId: string, note?: string): Promise<PaymentProof> =>
    mock.disputePaymentProof(familyId, userId, memberId, bookingId, proofId, note),
  getReview: (familyId: string, userId: string, memberId: string, bookingId: string): Promise<FamilyReview> => mock.getFamilyBookingReview(familyId, userId, memberId, bookingId),
  putReview: (familyId: string, userId: string, memberId: string, bookingId: string, input: ReviewInput): Promise<FamilyReview> =>
    mock.putFamilyBookingReview(familyId, userId, memberId, bookingId, input).then((result) => result.review),
}

const apiImpl: typeof mockImpl = {
  list(familyId, _userId, memberId, status, cursor) {
    const search = new URLSearchParams()
    if (status) search.set('status', status)
    if (cursor) search.set('cursor', cursor)
    const text = search.toString()
    return call<Page<FamilyBooking>>(`${base(familyId, memberId)}${text ? `?${text}` : ''}`).then(pageOf)
  },
  get: (familyId, _userId, memberId, bookingId) => call<FamilyBooking>(`${base(familyId, memberId)}/${id(bookingId)}`),
  create: (familyId, _userId, memberId, input) => call<FamilyBooking>(base(familyId, memberId), { method: 'POST', body: input }),
  cancel: (familyId, _userId, memberId, bookingId, note) => call<FamilyBooking>(`${base(familyId, memberId)}/${id(bookingId)}/cancel`, { method: 'POST', body: note ? { note } : {} }),
  proofs: (familyId, _userId, memberId, bookingId) => call<PaymentProof[]>(`${base(familyId, memberId)}/${id(bookingId)}/payment-proofs`),
  uploadProof(familyId, _userId, memberId, bookingId, file) {
    const form = new FormData()
    form.append('file', file)
    return call<PaymentProof>(`${base(familyId, memberId)}/${id(bookingId)}/payment-proofs`, { method: 'POST', body: form })
  },
  downloadProof: (familyId, _userId, memberId, bookingId, proofId) => apiFetchBlob(`${base(familyId, memberId)}/${id(bookingId)}/payment-proofs/${id(proofId)}/file`),
  disputeProof: (familyId, _userId, memberId, bookingId, proofId, note) =>
    call<PaymentProof>(`${base(familyId, memberId)}/${id(bookingId)}/payment-proofs/${id(proofId)}/dispute`, { method: 'POST', body: note ? { note } : {} }),
  getReview: (familyId, _userId, memberId, bookingId) => call<FamilyReview>(`${base(familyId, memberId)}/${id(bookingId)}/review`),
  // `PUT` devolve 201 (criada) ou 200 (editada): a UI não distingue.
  putReview: (familyId, _userId, memberId, bookingId, input) => call<FamilyReview>(`${base(familyId, memberId)}/${id(bookingId)}/review`, { method: 'PUT', body: input }),
}

export const consultationService = hasApiBackend() ? apiImpl : mockImpl
