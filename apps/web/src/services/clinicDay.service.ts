import * as mock from '@/mocks/handlers/clinicDay'
import { hasApiBackend } from '@/lib/apiClient'
import { clinicApiFetch } from '@/lib/clinicApiClient'
import { AppError } from '@/lib/errors'
import { clinicSessionStore } from '@/lib/storage'
import type {
  ClinicBooking,
  ClinicFollowUp,
  ClinicFollowUpInput,
  ClinicReportSummary,
} from '@/types/clinic'
import { toBooking } from './clinicPortal.service'

/**
 * Dia da clínica (M14 Q, BR-CLN-25..30): confirmado por telefone, chegou/iniciar/faltou, retorno
 * ("voltar em N semanas/meses") e indicadores (`/clinic-portal/agenda/{id}/{confirm,arrive,start,
 * no-show,follow-up}`, `/follow-ups`, `/reports/summary`). Mesmo padrão dos outros serviços da
 * clínica: backend simulado sem `VITE_API_URL`, `clinicApiFetch` com a API real.
 */

type ApiBooking = Parameters<typeof toBooking>[0]

const agenda = (id: string, action: string) => `/agenda/${id}/${action}`

const apiImpl = {
  async confirmByPhone(id: string): Promise<ClinicBooking> {
    return toBooking(await clinicApiFetch<ApiBooking>(agenda(id, 'confirm'), { method: 'PUT' }))
  },
  async arrive(id: string): Promise<ClinicBooking> {
    return toBooking(await clinicApiFetch<ApiBooking>(agenda(id, 'arrive'), { method: 'PUT' }))
  },
  async start(id: string): Promise<ClinicBooking> {
    return toBooking(await clinicApiFetch<ApiBooking>(agenda(id, 'start'), { method: 'PUT' }))
  },
  async noShow(id: string): Promise<ClinicBooking> {
    return toBooking(await clinicApiFetch<ApiBooking>(agenda(id, 'no-show'), { method: 'PUT' }))
  },
  async setFollowUp(id: string, input: ClinicFollowUpInput): Promise<ClinicBooking> {
    return toBooking(
      await clinicApiFetch<ApiBooking>(agenda(id, 'follow-up'), {
        method: 'PUT',
        body: { amount: input.amount, unit: input.unit },
      }),
    )
  },
  async clearFollowUp(id: string): Promise<ClinicBooking> {
    return toBooking(await clinicApiFetch<ApiBooking>(agenda(id, 'follow-up'), { method: 'DELETE' }))
  },
  listFollowUps: (until?: string) =>
    clinicApiFetch<ClinicFollowUp[]>(`/follow-ups${until ? `?until=${encodeURIComponent(until)}` : ''}`),
  getReportSummary: (params: { from: string; to: string; professionalId?: string }) => {
    const query = new URLSearchParams({ from: params.from, to: params.to })
    if (params.professionalId) query.set('professionalId', params.professionalId)
    return clinicApiFetch<ClinicReportSummary>(`/reports/summary?${query}`)
  },
}

function mockAccountId(): string {
  const clinicAccountId = clinicSessionStore.getAccountId()
  if (!clinicAccountId) throw new AppError('INVALID_CREDENTIALS')
  return clinicAccountId
}

const mockImpl: typeof apiImpl = {
  confirmByPhone: (id) => mock.confirmClinicBookingByPhone(mockAccountId(), id),
  arrive: (id) => mock.arriveClinicBooking(mockAccountId(), id),
  start: (id) => mock.startClinicBooking(mockAccountId(), id),
  noShow: (id) => mock.noShowClinicBooking(mockAccountId(), id),
  setFollowUp: (id, input) => mock.setClinicFollowUp(mockAccountId(), id, input),
  clearFollowUp: (id) => mock.clearClinicFollowUp(mockAccountId(), id),
  listFollowUps: (until) => mock.listClinicFollowUps(mockAccountId(), until),
  getReportSummary: (params) => mock.getClinicReportSummary(mockAccountId(), params),
}

export const clinicDayService = hasApiBackend() ? apiImpl : mockImpl
