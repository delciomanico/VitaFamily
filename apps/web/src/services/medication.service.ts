import * as api from '@/mocks/handlers/medications'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { todayISO } from '@/lib/date'
import { nextDoseAt } from '@/lib/medication'
import type { MedicationDetail, MedicationPlan, MedicationSummary } from '@/types/medication'
import { collectPerMember, findPerMember } from './apiMembers'

export type { UpdateMedicationInput } from '@/mocks/handlers/medications'
type UpdateMedicationInput = api.UpdateMedicationInput

/** `MedicationPlan` (openapi.yaml): sem `familyId` e com nulos em vez de campos ausentes. */
export interface ApiPlan {
  id: string
  memberId: string
  prescriptionId?: string | null
  name: string
  dosage: string
  scheduleType: 'FIXED_TIMES' | 'INTERVAL'
  times?: string[]
  daysOfWeek?: number[]
  intervalHours?: number | null
  startAt: string
  endAt?: string | null
  continuous: boolean
  notes?: string | null
  status: 'ACTIVE' | 'ENDED'
}

export function toPlan(familyId: string, plan: ApiPlan): MedicationPlan {
  return {
    id: plan.id,
    familyId,
    memberId: plan.memberId,
    prescriptionId: plan.prescriptionId ?? undefined,
    name: plan.name,
    dosage: plan.dosage,
    scheduleType: plan.scheduleType,
    times: plan.scheduleType === 'FIXED_TIMES' ? plan.times : undefined,
    daysOfWeek: plan.daysOfWeek?.length ? plan.daysOfWeek : undefined,
    intervalHours: plan.intervalHours ?? undefined,
    startAt: plan.startAt,
    endAt: plan.endAt ?? undefined,
    continuous: plan.continuous,
    notes: plan.notes ?? undefined,
    status: plan.status,
  }
}

const planPath = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}/medication-plans`

function summarize(plan: MedicationPlan, memberName: string, now: Date): MedicationSummary {
  const next = nextDoseAt(plan, now)
  return { plan, memberName, nextDoseAt: next, remindersOn: next !== null }
}

/** Fim do dia (23:59 local) da data `YYYY-MM-DD`, em ISO. */
function endOfLocalDay(date: string): string {
  const end = new Date(`${date}T00:00`)
  end.setHours(23, 59, 0, 0)
  return end.toISOString()
}

async function apiListMedications(familyId: string): Promise<MedicationSummary[]> {
  const now = new Date()
  const entries = await collectPerMember<ApiPlan>(familyId, (m) => `${planPath(familyId, m)}?limit=100`)
  return entries
    .map(({ member, item }) => summarize(toPlan(familyId, item), member.name, now))
    .sort((a, b) => (a.nextDoseAt ?? '9').localeCompare(b.nextDoseAt ?? '9') || a.plan.name.localeCompare(b.plan.name))
}

async function apiGetMedication(familyId: string, id: string): Promise<MedicationDetail> {
  const { member, item } = await findPerMember<ApiPlan>(familyId, (m) => `${planPath(familyId, m)}/${id}`)
  const plan = toPlan(familyId, item)
  let prescription: MedicationDetail['prescription']
  if (plan.prescriptionId) {
    prescription = await apiFetch<{ id: string; issuedOn: string; doctorName?: string | null }>(
      `/families/${familyId}/members/${member.id}/prescriptions/${plan.prescriptionId}`,
    )
      .then((p) => ({ id: p.id, issuedOn: p.issuedOn, doctorName: p.doctorName ?? undefined }))
      .catch(() => undefined)
  }
  return { ...summarize(plan, member.name, new Date()), prescription }
}

async function apiUpdateMedication(
  familyId: string,
  id: string,
  input: UpdateMedicationInput,
): Promise<MedicationPlan> {
  const { member } = await findPerMember<ApiPlan>(familyId, (m) => `${planPath(familyId, m)}/${id}`)
  const schedule =
    input.scheduleType === 'FIXED_TIMES'
      ? { scheduleType: 'FIXED_TIMES', times: input.times, intervalHours: null }
      : { scheduleType: 'INTERVAL', intervalHours: input.intervalHours }
  // TBD: o contrato não permite mudar `startAt`, logo a hora da 1.ª toma de um intervalo não é editável.
  const updated = await apiFetch<ApiPlan>(`${planPath(familyId, member.id)}/${id}`, {
    method: 'PATCH',
    body: {
      name: input.name.trim(),
      dosage: input.dosage.trim(),
      notes: input.notes?.trim() || null,
      ...schedule,
      continuous: input.continuous,
      endAt: input.continuous || !input.endDate || input.endDate < todayISO() ? null : endOfLocalDay(input.endDate),
    },
  })
  return toPlan(familyId, updated)
}

async function apiEndMedication(familyId: string, id: string): Promise<MedicationPlan> {
  const { member } = await findPerMember<ApiPlan>(familyId, (m) => `${planPath(familyId, m)}/${id}`)
  const ended = await apiFetch<ApiPlan>(`${planPath(familyId, member.id)}/${id}/status`, {
    method: 'PUT',
    body: { status: 'ENDED' },
  })
  return toPlan(familyId, ended)
}

/** Medicamentos (planos de toma). Com `VITE_API_URL` usa `/families/{id}/members/{id}/medication-plans`. */
export const medicationService = hasApiBackend()
  ? {
      listMedications: (familyId: string, _userId: string) => apiListMedications(familyId),
      getMedication: (familyId: string, _userId: string, id: string) => apiGetMedication(familyId, id),
      updateMedication: (familyId: string, _userId: string, id: string, input: UpdateMedicationInput) =>
        apiUpdateMedication(familyId, id, input),
      endMedication: (familyId: string, _userId: string, id: string) => apiEndMedication(familyId, id),
    }
  : {
      listMedications: api.listMedications,
      getMedication: api.getMedication,
      updateMedication: api.updateMedication,
      endMedication: api.endMedication,
    }
