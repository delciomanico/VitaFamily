import * as mock from '@/mocks/handlers/adminConsultations'
import { apiFetch, apiFetchBlob, hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined } from '@/lib/professionalApiClient'
import type {
  AdminPaymentDisputeDetail,
  AdminPaymentDisputeItem,
  AdminReviewReportDetail,
  AdminReviewReportItem,
  PaymentDisputeDecision,
  ReviewReportDecision,
} from '@/types/consultations'
import type { Page } from '@/types/marketplace'

/**
 * Disputas de pagamento e denúncias de avaliações (`/admin/payment-disputes*` e `/admin/review-reports*`, MK3,
 * BR-MKT-58/60/63). Mesma sessão de `User` com `platformRole`. O admin vê só o comprovativo e a marcação, ou
 * só a avaliação denunciada; cada abertura e cada descarregamento são auditados no servidor.
 */
const call = <T>(path: string, options?: { method?: string; body?: unknown }) => apiFetch<unknown>(`/admin${path}`, options).then((data) => nullsToUndefined<T>(data))
const id = encodeURIComponent
const pageOf = <T>(page: Page<T>): Page<T> => ({ items: page.items, nextCursor: page.nextCursor ?? null })
const query = (status?: string, cursor?: string) => {
  const search = new URLSearchParams()
  if (status) search.set('status', status)
  if (cursor) search.set('cursor', cursor)
  const text = search.toString()
  return text ? `?${text}` : ''
}

const mockImpl = {
  listDisputes: (status?: 'DISPUTED' | 'DECIDED', cursor?: string): Promise<Page<AdminPaymentDisputeItem>> => mock.adminListPaymentDisputes({ status, cursor }),
  getDispute: (proofId: string): Promise<AdminPaymentDisputeDetail> => mock.adminGetPaymentDispute(proofId),
  downloadProof: (proofId: string): Promise<Blob> => mock.adminDownloadPaymentProof(proofId),
  decideDispute: (proofId: string, decision: PaymentDisputeDecision): Promise<AdminPaymentDisputeDetail> => mock.adminDecidePaymentDispute(proofId, decision),
  listReviewReports: (status?: 'OPEN' | 'DECIDED', cursor?: string): Promise<Page<AdminReviewReportItem>> => mock.adminListReviewReports({ status, cursor }),
  getReviewReport: (reportId: string): Promise<AdminReviewReportDetail> => mock.adminGetReviewReport(reportId),
  decideReviewReport: (reportId: string, decision: ReviewReportDecision): Promise<AdminReviewReportDetail> => mock.adminDecideReviewReport(reportId, decision),
}

const apiImpl: typeof mockImpl = {
  listDisputes: (status, cursor) => call<Page<AdminPaymentDisputeItem>>(`/payment-disputes${query(status, cursor)}`).then(pageOf),
  getDispute: (proofId) => call<AdminPaymentDisputeDetail>(`/payment-disputes/${id(proofId)}`),
  downloadProof: (proofId) => apiFetchBlob(`/admin/payment-disputes/${id(proofId)}/file`),
  decideDispute: (proofId, decision) => call<AdminPaymentDisputeDetail>(`/payment-disputes/${id(proofId)}/decisions`, { method: 'POST', body: { decision } }),
  listReviewReports: (status, cursor) => call<Page<AdminReviewReportItem>>(`/review-reports${query(status, cursor)}`).then(pageOf),
  getReviewReport: (reportId) => call<AdminReviewReportDetail>(`/review-reports/${id(reportId)}`),
  decideReviewReport: (reportId, decision) => call<AdminReviewReportDetail>(`/review-reports/${id(reportId)}/decisions`, { method: 'POST', body: { decision } }),
}

export const adminConsultationService = hasApiBackend() ? apiImpl : mockImpl
