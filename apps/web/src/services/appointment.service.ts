import * as api from '@/mocks/handlers/appointments'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { AppError } from '@/lib/errors'
import type { Appointment, AppointmentItem } from '@/types/appointment'
import type { AvailableSlot } from '@/types/clinic'
import { collectPerMember, findPerMember } from './apiMembers'
import { clinicService } from './clinic.service'

export type { AppointmentInput, AppointmentRequestInput, NewAppointmentInput } from '@/mocks/handlers/appointments'

/** `Appointment` (openapi.yaml): sem `familyId` e `slotId`; nulos em vez de ausentes. */
export interface ApiAppointment {
  id: string
  memberId: string
  scheduledAt: string
  status: Appointment['status']
  professionalName?: string | null
  specialty?: string | null
  clinicId?: string | null
  clinicName?: string | null
  reason?: string | null
  notes?: string | null
}

export function toAppointment(familyId: string, a: ApiAppointment): Appointment {
  return {
    id: a.id,
    familyId,
    memberId: a.memberId,
    scheduledAt: a.scheduledAt,
    status: a.status,
    specialty: a.specialty ?? undefined,
    reason: a.reason ?? undefined,
    professionalName: a.professionalName ?? undefined,
    clinicId: a.clinicId ?? undefined,
    clinicName: a.clinicName ?? undefined,
    notes: a.notes ?? undefined,
  }
}

const aptPath = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}/appointments`

function body(input: api.AppointmentInput, clinicName?: string) {
  return {
    scheduledAt: new Date(input.scheduledAt).toISOString(),
    specialty: input.specialty?.trim() || null,
    clinicId: input.clinicId ?? null,
    clinicName: clinicName ?? null,
    professionalName: input.professionalName?.trim() || null,
    notes: input.notes?.trim() || null,
  }
}

async function clinicNameOf(familyId: string, clinicId?: string): Promise<string | undefined> {
  if (!clinicId) return undefined
  return (await clinicService.listClinics(familyId)).find((c) => c.id === clinicId)?.name
}

async function apiListAppointments(familyId: string): Promise<AppointmentItem[]> {
  const entries = await collectPerMember<ApiAppointment>(familyId, (m) => `${aptPath(familyId, m)}?limit=100`)
  return entries
    .map(({ member, item }) => ({ appointment: toAppointment(familyId, item), memberName: member.name }))
    .sort((a, b) => a.appointment.scheduledAt.localeCompare(b.appointment.scheduledAt))
}

async function apiGetAppointment(familyId: string, id: string): Promise<AppointmentItem> {
  const { member, item } = await findPerMember<ApiAppointment>(familyId, (m) => `${aptPath(familyId, m)}/${id}`)
  return { appointment: toAppointment(familyId, item), memberName: member.name }
}

async function apiCreateAppointment(familyId: string, input: api.NewAppointmentInput): Promise<Appointment> {
  const created = await apiFetch<ApiAppointment>(aptPath(familyId, input.memberId), {
    method: 'POST',
    body: body(input, await clinicNameOf(familyId, input.clinicId)),
  })
  return toAppointment(familyId, created)
}

async function apiUpdateAppointment(familyId: string, id: string, input: api.AppointmentInput): Promise<Appointment> {
  const { member } = await findPerMember<ApiAppointment>(familyId, (m) => `${aptPath(familyId, m)}/${id}`)
  const updated = await apiFetch<ApiAppointment>(`${aptPath(familyId, member.id)}/${id}`, {
    method: 'PATCH',
    body: body(input, await clinicNameOf(familyId, input.clinicId)),
  })
  return toAppointment(familyId, updated)
}

async function apiSetStatus(
  familyId: string,
  id: string,
  status: 'CANCELLED' | 'COMPLETED' | 'NO_SHOW',
): Promise<Appointment> {
  const { member } = await findPerMember<ApiAppointment>(familyId, (m) => `${aptPath(familyId, m)}/${id}`)
  const updated = await apiFetch<ApiAppointment>(`${aptPath(familyId, member.id)}/${id}/status`, {
    method: 'PUT',
    body: { status },
  })
  return toAppointment(familyId, updated)
}

/**
 * Consultas. Com `VITE_API_URL` usa `/families/{id}/members/{id}/appointments`.
 * Pedidos em horários de clínicas parceiras (D17) não existem no contrato real: sem horários
 * publicados, e o pedido falha com NOT_FOUND.
 */
export const appointmentService = hasApiBackend()
  ? {
      listAppointments: (familyId: string, _userId: string) => apiListAppointments(familyId),
      getAppointment: (familyId: string, _userId: string, id: string) => apiGetAppointment(familyId, id),
      listAvailableSlots: async (_familyId: string, _specialty: string): Promise<AvailableSlot[]> => [],
      requestAppointment: async (): Promise<Appointment> => {
        throw new AppError('NOT_FOUND')
      },
      createAppointment: (familyId: string, _userId: string, input: api.NewAppointmentInput) =>
        apiCreateAppointment(familyId, input),
      updateAppointment: (familyId: string, _userId: string, id: string, input: api.AppointmentInput) =>
        apiUpdateAppointment(familyId, id, input),
      setAppointmentStatus: (
        familyId: string,
        _userId: string,
        id: string,
        status: 'CANCELLED' | 'COMPLETED' | 'NO_SHOW',
      ) => apiSetStatus(familyId, id, status),
    }
  : {
      listAppointments: api.listAppointments,
      getAppointment: api.getAppointment,
      listAvailableSlots: api.listAvailableSlots,
      requestAppointment: api.requestAppointment,
      createAppointment: api.createAppointment,
      updateAppointment: api.updateAppointment,
      setAppointmentStatus: api.setAppointmentStatus,
    }
