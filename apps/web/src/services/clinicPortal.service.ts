import * as mock from '@/mocks/handlers/clinicPortal'
import { hasApiBackend } from '@/lib/apiClient'
import {
  clinicApiFetch,
  refreshClinicAccessToken,
  setClinicAccessToken,
  type ClinicTokenResponse,
} from '@/lib/clinicApiClient'
import { AppError } from '@/lib/errors'
import { clinicSessionStore } from '@/lib/storage'
import type {
  ClinicAccount,
  ClinicBooking,
  ClinicCompleteInput,
  ClinicRequestDecision,
  ClinicSession,
  ClinicSlot,
  ClinicSlotView,
  PublishSlotsInput,
} from '@/types/clinic'

/**
 * Portal da clínica parceira (`/clinic-portal/*`, D17/D18, ADR-020).
 *
 * Sessão **separada** da da app de família: outro login, outro token (`clinicApiClient`), outro
 * armazenamento no browser. Nenhuma função aqui recebe `userId`/`familyId`: a clínica e o papel
 * vêm sempre da sessão, como no contrato (authorization.md §6.1).
 *
 * Divergência conhecida (contrato, não protótipo): `ClinicTokenResponse` devolve apenas
 * `clinicId` e `role` e o portal não tem rota que descreva a clínica — com a API real o nome da
 * clínica não é conhecido pela UI (só o e-mail da conta, e apenas na aba onde se fez login).
 */

/** Forma das respostas `[...]` do portal (nulos em vez de ausentes, como em `openapi.yaml`). */
interface ApiClinicAccount {
  id: string
  clinicId: string
  email: string
  role: ClinicAccount['role']
  status: ClinicAccount['status']
}

interface ApiClinicSlot {
  id: string
  clinicId: string
  specialty: string
  professionalName?: string | null
  startsAt: string
  durationMinutes: number
}

interface ApiClinicSlotView extends ApiClinicSlot {
  state: ClinicSlotView['state']
}

interface ApiClinicBooking {
  id: string
  status: ClinicBooking['status']
  scheduledAt: string
  specialty?: string | null
  professionalName?: string | null
  patientName: string
  notes?: string | null
  responseNote?: string | null
}

const toSlot = (slot: ApiClinicSlot): ClinicSlot => ({
  id: slot.id,
  clinicId: slot.clinicId,
  specialty: slot.specialty,
  professionalName: slot.professionalName ?? undefined,
  startsAt: slot.startsAt,
  durationMinutes: slot.durationMinutes,
})

const toSlotView = (slot: ApiClinicSlotView): ClinicSlotView => ({ ...toSlot(slot), state: slot.state })

const toBooking = (booking: ApiClinicBooking): ClinicBooking => ({
  id: booking.id,
  status: booking.status,
  scheduledAt: booking.scheduledAt,
  specialty: booking.specialty ?? undefined,
  professionalName: booking.professionalName ?? undefined,
  patientName: booking.patientName,
  notes: booking.notes ?? undefined,
  responseNote: booking.responseNote ?? undefined,
})

const toAccount = (account: ApiClinicAccount): ClinicAccount => ({ ...account })

const byScheduledAt = (a: ClinicBooking, b: ClinicBooking) => a.scheduledAt.localeCompare(b.scheduledAt)

/** `ClinicCompleteAppointmentRequest` (openapi.yaml): o corpo exato de `complete`. */
function completeBody(input: ClinicCompleteInput) {
  const prescription = input.prescription
  return {
    outcomeNote: input.outcomeNote?.trim() || null,
    prescription: prescription
      ? {
          issuedOn: prescription.issuedOn,
          doctorName: prescription.doctorName?.trim() || null,
          notes: prescription.notes?.trim() || null,
          // `MedicationPlanInput`: horas fixas, a começar hoje; sem fim = uso contínuo (BR-MED-02).
          medications: prescription.medications.map((medication) => {
            const startAt = new Date()
            startAt.setHours(0, 0, 0, 0)
            let endAt: string | null = null
            if (medication.durationDays !== undefined) {
              const last = new Date(startAt)
              last.setDate(last.getDate() + medication.durationDays - 1)
              last.setHours(23, 59, 0, 0)
              endAt = last.toISOString()
            }
            return {
              name: medication.name.trim(),
              dosage: medication.dosage.trim(),
              scheduleType: 'FIXED_TIMES' as const,
              times: medication.times,
              startAt: startAt.toISOString(),
              endAt,
              continuous: medication.durationDays === undefined,
              notes: medication.notes?.trim() || null,
            }
          }),
        }
      : null,
  }
}

const apiImpl = {
  async login(email: string, password: string): Promise<ClinicSession> {
    const tokens = await clinicApiFetch<ClinicTokenResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })
    setClinicAccessToken(tokens.accessToken)
    return { clinicId: tokens.clinicId, role: tokens.role, email: email.trim().toLowerCase() }
  },

  /** Retoma a sessão ao abrir o portal: cookie `clinic_refresh_token` (nunca o de `User`). */
  async restore(): Promise<ClinicSession | null> {
    const tokens = await refreshClinicAccessToken()
    return tokens ? { clinicId: tokens.clinicId, role: tokens.role } : null
  },

  async logout(): Promise<void> {
    try {
      await clinicApiFetch<void>('/auth/logout', { method: 'POST' })
    } finally {
      setClinicAccessToken(null)
    }
  },

  async listStaff(): Promise<ClinicAccount[]> {
    return (await clinicApiFetch<ApiClinicAccount[]>('/staff')).map(toAccount)
  },

  async createStaff(email: string): Promise<ClinicAccount> {
    return toAccount(
      await clinicApiFetch<ApiClinicAccount>('/staff', { method: 'POST', body: { email: email.trim().toLowerCase() } }),
    )
  },

  removeStaff(clinicAccountId: string): Promise<void> {
    return clinicApiFetch<void>(`/staff/${clinicAccountId}`, { method: 'DELETE' })
  },

  async listSlots(): Promise<ClinicSlotView[]> {
    return (await clinicApiFetch<ApiClinicSlotView[]>('/slots')).map(toSlotView)
  },

  async publishSlots(input: PublishSlotsInput): Promise<ClinicSlot[]> {
    const created = await clinicApiFetch<ApiClinicSlot[]>('/slots', {
      method: 'POST',
      body: {
        date: input.date,
        times: input.times,
        specialty: input.specialty.trim(),
        professionalName: input.professionalName?.trim() || null,
        durationMinutes: input.durationMinutes,
      },
    })
    return created.map(toSlot)
  },

  removeSlot(slotId: string): Promise<void> {
    return clinicApiFetch<void>(`/slots/${slotId}`, { method: 'DELETE' })
  },

  async listRequests(): Promise<ClinicBooking[]> {
    return (await clinicApiFetch<ApiClinicBooking[]>('/requests')).map(toBooking).sort(byScheduledAt)
  },

  async respondRequest(appointmentId: string, decision: ClinicRequestDecision, note?: string): Promise<ClinicBooking> {
    return toBooking(
      await clinicApiFetch<ApiClinicBooking>(`/requests/${appointmentId}`, {
        method: 'PUT',
        body: { decision, note: note?.trim() || null },
      }),
    )
  },

  async listAgenda(): Promise<ClinicBooking[]> {
    return (await clinicApiFetch<ApiClinicBooking[]>('/agenda')).map(toBooking).sort(byScheduledAt)
  },

  async cancelAppointment(appointmentId: string, note: string): Promise<ClinicBooking> {
    return toBooking(
      await clinicApiFetch<ApiClinicBooking>(`/agenda/${appointmentId}/cancel`, {
        method: 'PUT',
        body: { note: note.trim() },
      }),
    )
  },

  async completeAppointment(appointmentId: string, input: ClinicCompleteInput): Promise<ClinicBooking> {
    return toBooking(
      await clinicApiFetch<ApiClinicBooking>(`/agenda/${appointmentId}/complete`, {
        method: 'PUT',
        body: completeBody(input),
      }),
    )
  },
}

/** Conta em sessão no backend simulado (equivalente ao token da API real). */
function mockAccountId(): string {
  const clinicAccountId = clinicSessionStore.getAccountId()
  if (!clinicAccountId) throw new AppError('INVALID_CREDENTIALS')
  return clinicAccountId
}

const mockImpl = {
  async login(email: string, password: string): Promise<ClinicSession> {
    const { clinicAccountId, ...session } = await mock.clinicLogin(email, password)
    clinicSessionStore.setAccountId(clinicAccountId)
    return session
  },

  async restore(): Promise<ClinicSession | null> {
    const clinicAccountId = clinicSessionStore.getAccountId()
    if (!clinicAccountId) return null
    const result = await mock.clinicRefresh(clinicAccountId)
    if (!result) {
      clinicSessionStore.setAccountId(null)
      return null
    }
    const { clinicAccountId: _id, ...session } = result
    return session
  },

  logout(): Promise<void> {
    clinicSessionStore.setAccountId(null)
    return Promise.resolve()
  },

  listStaff: () => mock.listClinicStaff(mockAccountId()),
  createStaff: (email: string) => mock.createClinicStaff(mockAccountId(), email),
  removeStaff: (clinicAccountId: string) => mock.removeClinicStaff(mockAccountId(), clinicAccountId),

  listSlots: () => mock.listOwnClinicSlots(mockAccountId()),
  publishSlots: (input: PublishSlotsInput) => mock.publishClinicSlots(mockAccountId(), input),
  removeSlot: (slotId: string) => mock.removeClinicSlot(mockAccountId(), slotId),

  listRequests: () => mock.listClinicRequests(mockAccountId()),
  respondRequest: (appointmentId: string, decision: ClinicRequestDecision, note?: string) =>
    mock.respondClinicRequest(mockAccountId(), appointmentId, decision, note),

  listAgenda: () => mock.listClinicAgenda(mockAccountId()),
  cancelAppointment: (appointmentId: string, note: string) =>
    mock.cancelClinicAppointment(mockAccountId(), appointmentId, note),
  completeAppointment: (appointmentId: string, input: ClinicCompleteInput) =>
    mock.completeClinicAppointment(mockAccountId(), appointmentId, input),
}

export const clinicPortalService = hasApiBackend() ? apiImpl : mockImpl
