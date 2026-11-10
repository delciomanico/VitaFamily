import * as mock from '@/mocks/handlers/examOrders'
import { hasApiBackend } from '@/lib/apiClient'
import { clinicApiFetch, clinicApiFetchBlob } from '@/lib/clinicApiClient'
import { AppError } from '@/lib/errors'
import { clinicSessionStore } from '@/lib/storage'
import type { ClinicExamOrder, ClinicExamServiceTypeOption, ExamOrderItemInput } from '@/types/examOrder'
import { examOrderItemBody } from './clinicPortal.service'

/**
 * Pedidos de exame e declaração de presença do portal da clínica (M15 U/V, ADR-028). Só o Médico
 * cria e cancela; Admin, Gestor e Médico leem e imprimem — o servidor decide, a UI só esconde.
 */

interface ApiClinicExamOrder extends Omit<ClinicExamOrder, 'serviceTypeId' | 'note' | 'patientBirthDate' | 'cancelledAt'> {
  serviceTypeId?: string | null
  note?: string | null
  patientBirthDate?: string | null
  cancelledAt?: string | null
}

const toOrder = (o: ApiClinicExamOrder): ClinicExamOrder => ({
  ...o,
  serviceTypeId: o.serviceTypeId ?? undefined,
  note: o.note ?? undefined,
  patientBirthDate: o.patientBirthDate ?? undefined,
  cancelledAt: o.cancelledAt ?? undefined,
})

const path = (bookingId: string) => `/agenda/${bookingId}`

const apiImpl = {
  listExamServiceTypes: () => clinicApiFetch<ClinicExamServiceTypeOption[]>('/exam-service-types'),
  list: async (bookingId: string) =>
    (await clinicApiFetch<{ items: ApiClinicExamOrder[] }>(`${path(bookingId)}/exam-orders`)).items.map(toOrder),
  create: async (bookingId: string, items: ExamOrderItemInput[]) =>
    (
      await clinicApiFetch<{ items: ApiClinicExamOrder[] }>(`${path(bookingId)}/exam-orders`, {
        method: 'POST',
        body: { items: items.map(examOrderItemBody) },
      })
    ).items.map(toOrder),
  cancel: async (bookingId: string, orderId: string) =>
    toOrder(await clinicApiFetch<ApiClinicExamOrder>(`${path(bookingId)}/exam-orders/${orderId}/cancel`, { method: 'PUT' })),
  pdf: (bookingId: string) => clinicApiFetchBlob(`${path(bookingId)}/exam-orders/pdf`),
  statementPdf: (bookingId: string, includeProfessional: boolean) =>
    clinicApiFetchBlob(`${path(bookingId)}/attendance-statement/pdf?includeProfessional=${includeProfessional}`),
}

function mockAccountId(): string {
  const clinicAccountId = clinicSessionStore.getAccountId()
  if (!clinicAccountId) throw new AppError('INVALID_CREDENTIALS')
  return clinicAccountId
}

const mockImpl: typeof apiImpl = {
  listExamServiceTypes: () => mock.listClinicExamServiceTypes(mockAccountId()),
  list: async (id) => (await mock.listClinicExamOrders(mockAccountId(), id)).items,
  create: async (id, items) => (await mock.createClinicExamOrders(mockAccountId(), id, items)).items,
  cancel: (id, orderId) => mock.cancelClinicExamOrder(mockAccountId(), id, orderId),
  pdf: (id) => mock.getClinicExamOrdersPdf(mockAccountId(), id),
  statementPdf: (id, includeProfessional) => mock.getClinicAttendanceStatementPdf(mockAccountId(), id, includeProfessional),
}

export const clinicExamOrderService = hasApiBackend() ? apiImpl : mockImpl
