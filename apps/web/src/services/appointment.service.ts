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
  /** Marcação num horário de clínica parceira (D17): bloqueia a edição/reagendamento (BR-APT-09). */
  slotId?: string | null
  /** Motivo indicado pela clínica ao recusar ou cancelar (D17). */
  responseNote?: string | null
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
    slotId: a.slotId ?? undefined,
    responseNote: a.responseNote ?? undefined,
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

/** `AvailableSlot` (openapi.yaml): nulos em vez de ausentes. */
interface ApiAvailableSlot {
  id: string
  clinicId: string
  clinicName: string
  specialty: string
  professionalName?: string | null
  startsAt: string
  durationMinutes: number
}

/**
 * `GET /families/{familyId}/clinics/{clinicId}/slots` (D17): horários livres de cada clínica
 * parceira ativa, para a especialidade escolhida. O contrato é **por clínica** — a UI mostra as
 * parceiras com vagas lado a lado, por isso pergunta a cada uma (mesmo padrão de `apiMembers`).
 */
async function apiListAvailableSlots(familyId: string, specialty: string): Promise<AvailableSlot[]> {
  const clinics = (await clinicService.listClinics(familyId)).filter((c) => c.type === 'PARTNER')
  const query = specialty.trim() ? `?specialty=${encodeURIComponent(specialty.trim())}` : ''
  const perClinic = await Promise.all(
    clinics.map(async (clinic) => {
      try {
        return await apiFetch<ApiAvailableSlot[]>(`/families/${familyId}/clinics/${clinic.id}/slots${query}`)
      } catch {
        // Clínica entretanto arquivada ou sem horários: não impede as restantes.
        return []
      }
    }),
  )
  return perClinic
    .flat()
    .map((slot) => ({
      id: slot.id,
      clinicId: slot.clinicId,
      clinicName: slot.clinicName,
      specialty: slot.specialty,
      professionalName: slot.professionalName ?? undefined,
      startsAt: slot.startsAt,
      durationMinutes: slot.durationMinutes,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

/**
 * Pedido num horário publicado por uma clínica parceira (UC-APT-07, D17): `POST .../appointments`
 * com `slotId` + `clinicId` (obrigatório para identificar o horário). A consulta nasce
 * `REQUESTED`; `scheduledAt`/especialidade/profissional vêm do próprio horário, nunca do cliente.
 */
async function apiRequestAppointment(
  familyId: string,
  input: api.AppointmentRequestInput,
  slot: AvailableSlot,
): Promise<Appointment> {
  const created = await apiFetch<ApiAppointment>(aptPath(familyId, input.memberId), {
    method: 'POST',
    body: {
      scheduledAt: slot.startsAt,
      clinicId: slot.clinicId,
      slotId: slot.id,
      notes: input.notes?.trim() || null,
    },
  })
  return toAppointment(familyId, created)
}

/**
 * Consultas. Com `VITE_API_URL` usa `/families/{id}/members/{id}/appointments` e, nas clínicas
 * parceiras, os horários publicados (`/clinics/{id}/slots`, D17).
 */
export const appointmentService = hasApiBackend()
  ? {
      listAppointments: (familyId: string, _userId: string) => apiListAppointments(familyId),
      getAppointment: (familyId: string, _userId: string, id: string) => apiGetAppointment(familyId, id),
      listAvailableSlots: apiListAvailableSlots,
      requestAppointment: async (
        familyId: string,
        _userId: string,
        input: api.AppointmentRequestInput,
        slot?: AvailableSlot,
      ): Promise<Appointment> => {
        // O `clinicId` do horário só é conhecido pela UI, que o acabou de listar (ver acima).
        if (!slot) throw new AppError('NOT_FOUND')
        return apiRequestAppointment(familyId, input, slot)
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
      listAvailableSlots: (familyId: string, specialty: string) => api.listAvailableSlots(familyId, specialty),
      // O backend simulado resolve a clínica pelo próprio horário; `slot` é ignorado.
      requestAppointment: (
        familyId: string,
        userId: string,
        input: api.AppointmentRequestInput,
        _slot?: AvailableSlot,
      ) => api.requestAppointment(familyId, userId, input),
      createAppointment: api.createAppointment,
      updateAppointment: api.updateAppointment,
      setAppointmentStatus: api.setAppointmentStatus,
    }
