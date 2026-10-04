import * as api from '@/mocks/handlers/medications'

export type { NewMedicationInput, NewPrescriptionInput, ScheduleInput } from '@/mocks/handlers/medications'

/** Receitas. Hoje mock; depois /api/v1/families/{id}/members/{id}/prescriptions. */
export const prescriptionService = {
  listPrescriptions: api.listPrescriptions,
  getPrescription: api.getPrescription,
  createPrescription: api.createPrescription,
  setPrescriptionStatus: api.setPrescriptionStatus,
}
