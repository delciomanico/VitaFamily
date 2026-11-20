import * as mock from '@/mocks/handlers/recordSharing'
import * as rx from '@/mocks/handlers/professionalPrescriptions'
import { hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined, professionalApiFetch } from '@/lib/professionalApiClient'
import type { Page } from '@/types/marketplace'
import type { ProfessionalPrescription, ProfessionalPrescriptionInput, ProfessionalShare, ProfessionalShareQuery, SharedRecordsView } from '@/types/recordSharing'

/**
 * Partilhas recebidas e receita digital do profissional (`/professional-portal/shares*` e
 * `/professional-portal/bookings/{id}/prescription*`, MK4). Sessão própria da conta de profissional; nunca ids de
 * família, membro nem utilizador. Abrir (`POST`) tem efeitos (vista e consumo): a resposta é só para mostrar e
 * nunca se guarda (`Cache-Control: no-store`). A receita só existe com `DIGITAL_PRESCRIPTION_ENABLED`; sem ela as
 * rotas dão `404`.
 */
const call = <T>(path: string, options?: { method?: string; body?: unknown }) => professionalApiFetch<unknown>(path, options).then((data) => nullsToUndefined<T>(data))
const id = encodeURIComponent
const pageOf = <T>(page: Page<T>): Page<T> => ({ items: page.items, nextCursor: page.nextCursor ?? null })

const mockImpl = {
  list: (query?: ProfessionalShareQuery): Promise<Page<ProfessionalShare>> => mock.listProfessionalShares(query),
  get: (shareId: string): Promise<ProfessionalShare> => mock.getProfessionalShare(shareId),
  open: (shareId: string): Promise<SharedRecordsView> => mock.openProfessionalShare(shareId),
  issuePrescription: (bookingId: string, input: ProfessionalPrescriptionInput): Promise<ProfessionalPrescription> => rx.issueProfessionalPrescription(bookingId, input),
  getPrescription: (bookingId: string): Promise<ProfessionalPrescription> => rx.getProfessionalBookingPrescription(bookingId),
}

const apiImpl: typeof mockImpl = {
  list(query = {}) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value) search.set(key, value)
    const text = search.toString()
    return call<Page<ProfessionalShare>>(`/shares${text ? `?${text}` : ''}`).then(pageOf)
  },
  get: (shareId) => call<ProfessionalShare>(`/shares/${id(shareId)}`),
  open: (shareId) => call<SharedRecordsView>(`/shares/${id(shareId)}/open`, { method: 'POST' }),
  issuePrescription: (bookingId, input) => call<ProfessionalPrescription>(`/bookings/${id(bookingId)}/prescriptions`, { method: 'POST', body: input }),
  getPrescription: (bookingId) => call<ProfessionalPrescription>(`/bookings/${id(bookingId)}/prescription`),
}

export const professionalShareService = hasApiBackend() ? apiImpl : mockImpl
