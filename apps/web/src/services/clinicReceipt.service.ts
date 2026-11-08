import * as mock from '@/mocks/handlers/clinicReceipts'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { clinicApiFetch } from '@/lib/clinicApiClient'
import { AppError } from '@/lib/errors'
import { clinicSessionStore } from '@/lib/storage'
import type {
  ClinicAuditPage,
  ClinicAuditQuery,
  ClinicProfile,
  ClinicProfileInput,
  ClinicReceipt,
  ClinicReceiptInput,
  ClinicReceiptPage,
  ClinicReceiptQuery,
  FamilyClinicReceipt,
  FamilyClinicReceiptPage,
} from '@/types/clinicReceipt'

/**
 * Recibos, Financeiro, perfil e auditoria do portal da clínica (M14 R, BR-CLN-31..40) e os
 * comprovativos do titular na app (BR-CLN-35). Mesmo padrão dos outros serviços: backend simulado
 * sem `VITE_API_URL`; com ele, `clinicApiFetch` (portal) e `apiFetch` (família).
 */

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

const apiImpl = {
  issue: (input: ClinicReceiptInput) =>
    clinicApiFetch<ClinicReceipt>('/receipts', {
      method: 'POST',
      body: {
        bookingKind: input.bookingKind,
        bookingId: input.bookingId,
        paymentMethod: input.paymentMethod,
        // Omitido ⇒ uma linha com o serviço do horário (um toque).
        lines: input.lines,
        note: input.note?.trim() || undefined,
      },
    }),
  void: (receiptId: string, reason: string) =>
    clinicApiFetch<ClinicReceipt>(`/receipts/${receiptId}/void`, { method: 'POST', body: { reason: reason.trim() } }),
  get: (receiptId: string) => clinicApiFetch<ClinicReceipt>(`/receipts/${receiptId}`),
  list: (params: ClinicReceiptQuery) =>
    clinicApiFetch<ClinicReceiptPage>(`/receipts${query({ ...params })}`),
  getProfile: () => clinicApiFetch<ClinicProfile>('/profile'),
  updateProfile: (input: ClinicProfileInput) => clinicApiFetch<ClinicProfile>('/profile', { method: 'PATCH', body: input }),
  listAudit: (params: ClinicAuditQuery) => clinicApiFetch<ClinicAuditPage>(`/audit${query({ ...params })}`),
}

function mockAccountId(): string {
  const clinicAccountId = clinicSessionStore.getAccountId()
  if (!clinicAccountId) throw new AppError('INVALID_CREDENTIALS')
  return clinicAccountId
}

const mockImpl: typeof apiImpl = {
  issue: (input) => mock.issueClinicReceipt(mockAccountId(), input),
  void: (receiptId, reason) => mock.voidClinicReceipt(mockAccountId(), receiptId, reason),
  get: (receiptId) => mock.getClinicReceipt(mockAccountId(), receiptId),
  list: (params) => mock.listClinicReceipts(mockAccountId(), params),
  getProfile: () => mock.getClinicProfile(mockAccountId()),
  updateProfile: (input) => mock.updateClinicProfile(mockAccountId(), input),
  listAudit: (params) => mock.listClinicAudit(mockAccountId(), params),
}

export const clinicReceiptService = hasApiBackend() ? apiImpl : mockImpl

const familyPath = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}/clinic-receipts`

const familyApiImpl = {
  list: (familyId: string, _userId: string, memberId: string, params: { limit?: number; cursor?: string } = {}) =>
    apiFetch<FamilyClinicReceiptPage>(`${familyPath(familyId, memberId)}${query({ ...params })}`),
  get: (familyId: string, _userId: string, memberId: string, receiptId: string) =>
    apiFetch<FamilyClinicReceipt>(`${familyPath(familyId, memberId)}/${receiptId}`),
}

const familyMockImpl: typeof familyApiImpl = {
  list: mock.listFamilyClinicReceipts,
  get: mock.getFamilyClinicReceipt,
}

/** Recibos recebidos pelo membro (titular/tutor), como comprovativos. */
export const familyReceiptService = hasApiBackend() ? familyApiImpl : familyMockImpl
