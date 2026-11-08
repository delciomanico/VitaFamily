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
  ClinicCompleteExamInput,
  ClinicCompleteInput,
  ClinicExamBooking,
  ClinicRequestDecision,
  ClinicSession,
  ClinicSlot,
  ClinicSlotView,
  ClinicStaffInput,
  ClinicWalkInInput,
  PublishSlotsInput,
  SlotKind,
} from '@/types/clinic'
import type { DocumentUpload } from '@/types/document'
import type { ClinicRecommendation, RecommendationOrigin } from '@/types/recommendation'

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
  professionalId?: string | null
  status: ClinicAccount['status']
}

interface ApiClinicSlot {
  id: string
  clinicId: string
  kind: SlotKind
  capacity: number
  specialty: string
  professionalName?: string | null
  professionalId?: string | null
  serviceTypeId?: string | null
  scheduleRuleId?: string | null
  startsAt: string
  durationMinutes: number
}

interface ApiClinicSlotView extends ApiClinicSlot {
  state: ClinicSlotView['state']
  bookedCount: number
  remaining: number
}

interface ApiClinicExamBooking {
  id: string
  status: ClinicExamBooking['status']
  scheduledAt: string
  examType?: string | null
  patientName: string
  notes?: string | null
  responseNote?: string | null
  resultsCount?: number
  documents?: ClinicExamBooking['documents']
  receiptId?: string | null
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
  source?: 'VITA' | 'MANUAL'
  clinicPatientId?: string | null
  slotId?: string | null
  /** M14 Q (BR-CLN-25/28/30). */
  confirmationStatus?: ClinicBooking['confirmationStatus'] | null
  confirmationSource?: ClinicBooking['confirmationSource'] | null
  dayState?: ClinicBooking['dayState'] | null
  arrivedAt?: string | null
  startedAt?: string | null
  waitingMinutes?: number | null
  followUpDueOn?: string | null
  /** M14 R (BR-CLN-31): nunca devolvido ao Médico. */
  receiptId?: string | null
}

const toSlot = (slot: ApiClinicSlot): ClinicSlot => ({
  id: slot.id,
  clinicId: slot.clinicId,
  kind: slot.kind,
  capacity: slot.capacity,
  specialty: slot.specialty,
  professionalName: slot.professionalName ?? undefined,
  professionalId: slot.professionalId ?? undefined,
  serviceTypeId: slot.serviceTypeId ?? undefined,
  scheduleRuleId: slot.scheduleRuleId ?? undefined,
  startsAt: slot.startsAt,
  durationMinutes: slot.durationMinutes,
})

const toSlotView = (slot: ApiClinicSlotView): ClinicSlotView => ({
  ...toSlot(slot),
  state: slot.state,
  bookedCount: slot.bookedCount,
  remaining: slot.remaining,
})

export const toExamBooking = (exam: ApiClinicExamBooking): ClinicExamBooking => ({
  id: exam.id,
  status: exam.status,
  scheduledAt: exam.scheduledAt,
  examType: exam.examType ?? undefined,
  patientName: exam.patientName,
  notes: exam.notes ?? undefined,
  responseNote: exam.responseNote ?? undefined,
  resultsCount: exam.resultsCount ?? 0,
  documents: exam.documents ?? [],
  receiptId: exam.receiptId ?? undefined,
})

const byExamTime = (a: ClinicExamBooking, b: ClinicExamBooking) => a.scheduledAt.localeCompare(b.scheduledAt)

/** `ClinicCompleteExaminationRequest` (openapi.yaml): parâmetros estruturados, sem interpretação (D11). */
function completeExamBody(input: ClinicCompleteExamInput) {
  return {
    results: input.results.map((r) => ({
      parameter: r.parameter.trim(),
      valueNumeric: r.valueNumeric ?? null,
      valueText: r.valueText?.trim() || null,
      unit: r.unit?.trim() || null,
      referenceMin: r.referenceMin ?? null,
      referenceMax: r.referenceMax ?? null,
    })),
    resultNote: input.resultNote?.trim() || null,
  }
}

export const toBooking = (booking: ApiClinicBooking): ClinicBooking => ({
  id: booking.id,
  status: booking.status,
  scheduledAt: booking.scheduledAt,
  specialty: booking.specialty ?? undefined,
  professionalName: booking.professionalName ?? undefined,
  patientName: booking.patientName,
  notes: booking.notes ?? undefined,
  responseNote: booking.responseNote ?? undefined,
  source: booking.source,
  clinicPatientId: booking.clinicPatientId ?? undefined,
  slotId: booking.slotId ?? undefined,
  confirmationStatus: booking.confirmationStatus ?? undefined,
  confirmationSource: booking.confirmationSource ?? undefined,
  dayState: booking.dayState ?? undefined,
  arrivedAt: booking.arrivedAt ?? undefined,
  startedAt: booking.startedAt ?? undefined,
  waitingMinutes: booking.waitingMinutes ?? undefined,
  followUpDueOn: booking.followUpDueOn ?? undefined,
  receiptId: booking.receiptId ?? undefined,
})

const toAccount = ({ professionalId, ...account }: ApiClinicAccount): ClinicAccount => ({
  ...account,
  ...(professionalId ? { professionalId } : {}),
})

const sessionOf = (tokens: ClinicTokenResponse, email?: string): ClinicSession => ({
  clinicId: tokens.clinicId,
  role: tokens.role,
  ...(tokens.professionalId ? { professionalId: tokens.professionalId } : {}),
  ...(email ? { email } : {}),
})

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

interface ApiClinicRecommendation {
  id: string
  appointmentId?: string | null
  examinationId?: string | null
  patientName: string
  text: string
  createdAt: string
}

const toRecommendation = (r: ApiClinicRecommendation): ClinicRecommendation => ({
  id: r.id,
  appointmentId: r.appointmentId ?? undefined,
  examinationId: r.examinationId ?? undefined,
  patientName: r.patientName,
  text: r.text,
  createdAt: r.createdAt,
})

/** `ClinicWalkInAppointmentRequest` (openapi.yaml, ADR-024, BR-CLN-18): exatamente um paciente. */
export type WalkInInput = ClinicWalkInInput

const apiImpl = {
  async login(email: string, password: string): Promise<ClinicSession> {
    const tokens = await clinicApiFetch<ClinicTokenResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })
    setClinicAccessToken(tokens.accessToken)
    return sessionOf(tokens, email.trim().toLowerCase())
  },

  /** Retoma a sessão ao abrir o portal: cookie `clinic_refresh_token` (nunca o de `User`). */
  async restore(): Promise<ClinicSession | null> {
    const tokens = await refreshClinicAccessToken()
    return tokens ? sessionOf(tokens) : null
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

  async createStaff(input: ClinicStaffInput): Promise<ClinicAccount> {
    return toAccount(
      await clinicApiFetch<ApiClinicAccount>('/staff', {
        method: 'POST',
        body: {
          email: input.email.trim().toLowerCase(),
          role: input.role ?? 'CLINIC_MANAGER',
          // Só o Médico leva `professionalId` (o Gestor com ele → VALIDATION_ERROR).
          professionalId: input.role === 'CLINIC_DOCTOR' ? input.professionalId : undefined,
        },
      }),
    )
  },

  removeStaff(clinicAccountId: string): Promise<void> {
    return clinicApiFetch<void>(`/staff/${clinicAccountId}`, { method: 'DELETE' })
  },

  async listSlots(kind?: SlotKind): Promise<ClinicSlotView[]> {
    const query = kind ? `?kind=${kind}` : ''
    return (await clinicApiFetch<ApiClinicSlotView[]>(`/slots${query}`)).map(toSlotView)
  },

  async publishSlots(input: PublishSlotsInput): Promise<ClinicSlot[]> {
    const created = await clinicApiFetch<ApiClinicSlot[]>('/slots', {
      method: 'POST',
      body: {
        kind: input.kind,
        capacity: input.kind === 'EXAM' ? (input.capacity ?? 1) : 1,
        date: input.date,
        times: input.times,
        // Com serviço, tipo/nome/duração vêm do catálogo (valores diferentes → VALIDATION_ERROR).
        specialty: input.serviceTypeId ? undefined : input.specialty?.trim(),
        professionalName: input.professionalId ? undefined : input.professionalName?.trim() || null,
        professionalId: input.professionalId ?? null,
        serviceTypeId: input.serviceTypeId ?? null,
        durationMinutes: input.serviceTypeId ? undefined : input.durationMinutes,
      },
    })
    return created.map(toSlot)
  },

  removeSlot(slotId: string): Promise<void> {
    return clinicApiFetch<void>(`/slots/${slotId}`, { method: 'DELETE' })
  },

  async updateSlotCapacity(slotId: string, capacity: number): Promise<ClinicSlotView> {
    return toSlotView(
      await clinicApiFetch<ApiClinicSlotView>(`/slots/${slotId}`, { method: 'PATCH', body: { capacity } }),
    )
  },

  async createRecommendation(origin: RecommendationOrigin, text: string): Promise<ClinicRecommendation> {
    return toRecommendation(
      await clinicApiFetch<ApiClinicRecommendation>('/recommendations', {
        method: 'POST',
        body: {
          appointmentId: 'appointmentId' in origin ? origin.appointmentId : null,
          examinationId: 'examinationId' in origin ? origin.examinationId : null,
          text: text.trim(),
        },
      }),
    )
  },

  async listRecommendations(origin: RecommendationOrigin): Promise<ClinicRecommendation[]> {
    const params = new URLSearchParams(origin as Record<string, string>)
    return (await clinicApiFetch<ApiClinicRecommendation[]>(`/recommendations?${params}`)).map(toRecommendation)
  },

  async listExamAgenda(): Promise<ClinicExamBooking[]> {
    return (await clinicApiFetch<ApiClinicExamBooking[]>('/exam-agenda')).map(toExamBooking).sort(byExamTime)
  },

  async cancelExam(examinationId: string, note: string): Promise<ClinicExamBooking> {
    return toExamBooking(
      await clinicApiFetch<ApiClinicExamBooking>(`/exam-agenda/${examinationId}/cancel`, {
        method: 'PUT',
        body: { note: note.trim() },
      }),
    )
  },

  /** `POST …/documents` (multipart): PDF dos resultados; a análise antivírus corre no servidor. */
  async uploadExamDocument(examinationId: string, upload: DocumentUpload): Promise<void> {
    if (!upload.file) return
    const form = new FormData()
    form.append('file', upload.file, upload.originalName)
    await clinicApiFetch<unknown>(`/exam-agenda/${examinationId}/documents`, { method: 'POST', body: form })
  },

  async completeExam(examinationId: string, input: ClinicCompleteExamInput): Promise<ClinicExamBooking> {
    return toExamBooking(
      await clinicApiFetch<ApiClinicExamBooking>(`/exam-agenda/${examinationId}/complete`, {
        method: 'PUT',
        body: completeExamBody(input),
      }),
    )
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

  lookupPatient: (email: string) =>
    clinicApiFetch<{ displayName: string }>('/patient-lookup', {
      method: 'POST',
      body: { email: email.trim().toLowerCase() },
    }),

  async createWalkIn(input: WalkInInput): Promise<ClinicBooking> {
    return toBooking(
      await clinicApiFetch<ApiClinicBooking>('/walk-in-appointments', {
        method: 'POST',
        body: {
          patientEmail: input.patientEmail ? input.patientEmail.trim().toLowerCase() : undefined,
          clinicPatientId: input.clinicPatientId,
          slotId: input.slotId,
          notes: input.notes?.trim() || null,
        },
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
  createStaff: (input: ClinicStaffInput) => mock.createClinicStaff(mockAccountId(), input),
  removeStaff: (clinicAccountId: string) => mock.removeClinicStaff(mockAccountId(), clinicAccountId),

  listSlots: (kind?: SlotKind) => mock.listOwnClinicSlots(mockAccountId(), kind),
  publishSlots: (input: PublishSlotsInput) => mock.publishClinicSlots(mockAccountId(), input),
  removeSlot: (slotId: string) => mock.removeClinicSlot(mockAccountId(), slotId),
  updateSlotCapacity: (slotId: string, capacity: number) =>
    mock.updateClinicSlotCapacity(mockAccountId(), slotId, capacity),

  createRecommendation: (origin: RecommendationOrigin, text: string) =>
    mock.createClinicRecommendation(mockAccountId(), { ...origin, text }),
  listRecommendations: (origin: RecommendationOrigin) => mock.listClinicRecommendations(mockAccountId(), origin),

  listExamAgenda: () => mock.listClinicExamAgenda(mockAccountId()),
  cancelExam: (examinationId: string, note: string) => mock.cancelClinicExam(mockAccountId(), examinationId, note),
  async uploadExamDocument(examinationId: string, upload: DocumentUpload): Promise<void> {
    await mock.uploadClinicExamDocument(mockAccountId(), examinationId, upload)
  },
  completeExam: (examinationId: string, input: ClinicCompleteExamInput) =>
    mock.completeClinicExam(mockAccountId(), examinationId, input),

  listRequests: () => mock.listClinicRequests(mockAccountId()),
  respondRequest: (appointmentId: string, decision: ClinicRequestDecision, note?: string) =>
    mock.respondClinicRequest(mockAccountId(), appointmentId, decision, note),

  lookupPatient: (email: string) => mock.lookupClinicPatient(mockAccountId(), email),
  createWalkIn: (input: WalkInInput) => mock.createClinicWalkIn(mockAccountId(), input),

  listAgenda: () => mock.listClinicAgenda(mockAccountId()),
  cancelAppointment: (appointmentId: string, note: string) =>
    mock.cancelClinicAppointment(mockAccountId(), appointmentId, note),
  completeAppointment: (appointmentId: string, input: ClinicCompleteInput) =>
    mock.completeClinicAppointment(mockAccountId(), appointmentId, input),
}

export const clinicPortalService = hasApiBackend() ? apiImpl : mockImpl
