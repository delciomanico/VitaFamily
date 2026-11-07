import * as mock from '@/mocks/handlers/clinicPatients'
import { hasApiBackend } from '@/lib/apiClient'
import { clinicApiFetch } from '@/lib/clinicApiClient'
import { AppError } from '@/lib/errors'
import { clinicSessionStore } from '@/lib/storage'
import type {
  ClinicCalendar,
  ClinicPatient,
  ClinicPatientInput,
  ClinicPatientPage,
  ClinicPatientPatch,
  ClinicPatientRecord,
  ClinicSearchResult,
  ClinicSharedHistory,
} from '@/types/clinic'
import { toBooking, toExamBooking } from './clinicPortal.service'

/**
 * Pacientes da clínica, ficha, histórico partilhado, ligação por código, pesquisa global e
 * calendário (`/clinic-portal/{patients,search,calendar}`, M14 P, BR-CLN-17..24). Mesmo padrão do
 * `clinicPortalService`: backend simulado sem `VITE_API_URL`, `clinicApiFetch` com a API real.
 * Nenhum pedido recebe ids Vita; a pesquisa é só sobre o registo da própria clínica.
 */

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** Campos opcionais vazios → `null` (limpar), como em `ClinicPatientPatch`. */
function patientBody(input: ClinicPatientPatch) {
  const body: Record<string, string | null> = {}
  if (input.name !== undefined) body.name = input.name?.trim() ?? ''
  for (const key of ['phone', 'email', 'birthDate', 'notes'] as const) {
    const value = input[key]
    if (value !== undefined) body[key] = value === null ? null : value.trim() || null
  }
  return body
}

const apiImpl = {
  listPatients: (params: { q?: string; limit?: number; cursor?: string } = {}) =>
    clinicApiFetch<ClinicPatientPage>(`/patients${query(params)}`),
  createPatient: (input: ClinicPatientInput) =>
    clinicApiFetch<ClinicPatient>('/patients', { method: 'POST', body: patientBody(input) }),
  getPatient: (id: string) => clinicApiFetch<ClinicPatient>(`/patients/${id}`),
  updatePatient: (id: string, patch: ClinicPatientPatch) =>
    clinicApiFetch<ClinicPatient>(`/patients/${id}`, { method: 'PATCH', body: patientBody(patch) }),

  async getRecord(id: string): Promise<ClinicPatientRecord> {
    const record = await clinicApiFetch<ClinicPatientRecord>(`/patients/${id}/record`)
    return {
      ...record,
      bookings: record.bookings.map(toBooking),
      examinations: record.examinations.map(toExamBooking),
    }
  },
  getSharedHistory: (id: string) => clinicApiFetch<ClinicSharedHistory>(`/patients/${id}/shared-history`),

  /** O código nunca é registado: segue só no corpo do pedido. */
  linkPatient: (input: { code: string; clinicPatientId?: string }) =>
    clinicApiFetch<ClinicPatient>('/patients/link', {
      method: 'POST',
      body: { code: input.code.trim(), clinicPatientId: input.clinicPatientId },
    }),

  async search(q: string): Promise<ClinicSearchResult> {
    return clinicApiFetch<ClinicSearchResult>(`/search${query({ q: q.trim() })}`)
  },
  getCalendar: (params: { from: string; to: string; professionalId?: string }) =>
    clinicApiFetch<ClinicCalendar>(`/calendar${query(params)}`),
}

function mockAccountId(): string {
  const clinicAccountId = clinicSessionStore.getAccountId()
  if (!clinicAccountId) throw new AppError('INVALID_CREDENTIALS')
  return clinicAccountId
}

const mockImpl: typeof apiImpl = {
  listPatients: (params) => mock.listClinicPatients(mockAccountId(), params),
  createPatient: (input) => mock.createClinicPatient(mockAccountId(), input),
  getPatient: (id) => mock.getClinicPatient(mockAccountId(), id),
  updatePatient: (id, patch) => mock.updateClinicPatient(mockAccountId(), id, patch),
  getRecord: (id) => mock.getClinicPatientRecord(mockAccountId(), id),
  getSharedHistory: (id) => mock.getClinicSharedHistory(mockAccountId(), id),
  linkPatient: (input) => mock.linkClinicPatient(mockAccountId(), input),
  search: (q) => mock.clinicGlobalSearch(mockAccountId(), q),
  getCalendar: (params) => mock.getClinicCalendar(mockAccountId(), params),
}

export const clinicPatientsService = hasApiBackend() ? apiImpl : mockImpl
