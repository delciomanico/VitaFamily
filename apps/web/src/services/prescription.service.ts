import * as api from '@/mocks/handlers/medications'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { MedicationPlan } from '@/types/medication'
import type {
  Prescription,
  PrescriptionDetail,
  PrescriptionStatus,
  PrescriptionSummary,
} from '@/types/prescription'
import { collectPerMember, findPerMember } from './apiMembers'
import { apiListDocuments, apiUploadDocuments } from './document.service'
import { toPlan, type ApiPlan } from './medication.service'

export type { NewMedicationInput, NewPrescriptionInput, ScheduleInput } from '@/mocks/handlers/medications'
type NewPrescriptionInput = api.NewPrescriptionInput
type NewMedicationInput = api.NewMedicationInput

/** `Prescription` (openapi.yaml): sem `familyId`/`clinicName`; planos embutidos. */
export interface ApiPrescription {
  id: string
  memberId: string
  issuedOn: string
  doctorName?: string | null
  notes?: string | null
  status: PrescriptionStatus
  medications: ApiPlan[]
}

const rxPath = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}/prescriptions`

export function toPrescription(familyId: string, rx: ApiPrescription): Prescription {
  return {
    id: rx.id,
    familyId,
    memberId: rx.memberId,
    issuedOn: rx.issuedOn,
    doctorName: rx.doctorName ?? undefined,
    notes: rx.notes ?? undefined,
    status: rx.status,
  }
}

/** Instante ISO de hoje à hora local `HH:mm`. */
function todayAt(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function toPlanInput(medication: NewMedicationInput) {
  const days = medication.continuous ? undefined : (medication.durationDays ?? 1)
  let endAt: string | null = null
  if (days) {
    const last = new Date()
    last.setDate(last.getDate() + days - 1)
    last.setHours(23, 59, 0, 0)
    endAt = last.toISOString()
  }
  const base = {
    name: medication.name.trim(),
    dosage: medication.dosage.trim(),
    notes: medication.notes?.trim() || null,
    continuous: medication.continuous,
    endAt,
  }
  return medication.scheduleType === 'FIXED_TIMES'
    ? { ...base, scheduleType: 'FIXED_TIMES', times: medication.times, startAt: todayAt('00:00') }
    : {
        ...base,
        scheduleType: 'INTERVAL',
        intervalHours: medication.intervalHours,
        startAt: todayAt(medication.firstTime),
      }
}

async function apiListPrescriptions(familyId: string): Promise<PrescriptionSummary[]> {
  const entries = await collectPerMember<ApiPrescription>(familyId, (m) => `${rxPath(familyId, m)}?limit=100`)
  return entries
    .map(({ member, item }) => ({
      prescription: toPrescription(familyId, item),
      memberName: member.name,
      medicationCount: item.medications.length,
    }))
    .sort((a, b) => b.prescription.issuedOn.localeCompare(a.prescription.issuedOn))
}

async function apiGetPrescription(familyId: string, id: string): Promise<PrescriptionDetail> {
  const { member, item } = await findPerMember<ApiPrescription>(familyId, (m) => `${rxPath(familyId, m)}/${id}`)
  const medications: MedicationPlan[] = item.medications.map((plan) => toPlan(familyId, plan))
  const documents = await apiListDocuments(familyId, member.id, 'PRESCRIPTION', id)
  return { prescription: toPrescription(familyId, item), memberName: member.name, medications, documents }
}

async function apiCreatePrescription(familyId: string, input: NewPrescriptionInput): Promise<Prescription> {
  const created = await apiFetch<ApiPrescription>(rxPath(familyId, input.memberId), {
    method: 'POST',
    body: {
      issuedOn: input.issuedOn,
      doctorName: input.doctorName?.trim() || null,
      notes: input.notes?.trim() || null,
      medications: input.medications.map(toPlanInput),
    },
  })
  await apiUploadDocuments(familyId, input.memberId, 'PRESCRIPTION', created.id, input.documents)
  return toPrescription(familyId, created)
}

async function apiSetPrescriptionStatus(
  familyId: string,
  id: string,
  status: Exclude<PrescriptionStatus, 'ACTIVE'>,
): Promise<Prescription> {
  const { member } = await findPerMember<ApiPrescription>(familyId, (m) => `${rxPath(familyId, m)}/${id}`)
  const updated = await apiFetch<ApiPrescription>(`${rxPath(familyId, member.id)}/${id}/status`, {
    method: 'PUT',
    body: { status },
  })
  return toPrescription(familyId, updated)
}

/** Receitas. Com `VITE_API_URL` usa `/families/{id}/members/{id}/prescriptions`. */
export const prescriptionService = hasApiBackend()
  ? {
      listPrescriptions: (familyId: string, _userId: string) => apiListPrescriptions(familyId),
      getPrescription: (familyId: string, _userId: string, id: string) => apiGetPrescription(familyId, id),
      createPrescription: (familyId: string, _userId: string, input: NewPrescriptionInput) =>
        apiCreatePrescription(familyId, input),
      setPrescriptionStatus: (
        familyId: string,
        _userId: string,
        id: string,
        status: Exclude<PrescriptionStatus, 'ACTIVE'>,
      ) => apiSetPrescriptionStatus(familyId, id, status),
    }
  : {
      listPrescriptions: api.listPrescriptions,
      getPrescription: api.getPrescription,
      createPrescription: api.createPrescription,
      setPrescriptionStatus: api.setPrescriptionStatus,
    }
